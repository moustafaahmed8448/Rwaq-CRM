"use client";

/**
 * Admin-only management page for the three reference lists — statuses,
 * acquisition channels and locations — including the colour each value is drawn
 * with across the dashboard, the clients table, the kanban and the marketing
 * page.
 *
 * It is a management surface over /api/options, not a replacement for the
 * pickers: a value created here appears immediately in the status/channel/
 * location dropdowns on the clients form and in the marketing campaign form, and
 * a value created there shows up here.
 *
 * The role check below is for UX only. Every mutating endpoint independently
 * rejects non-admins with a 403, so bypassing this redirect gains nothing — the
 * same defence-in-depth the archived and settings pages rely on.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Plus, Settings2, Trash2, Pencil, X } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage, readApiError } from "@/lib/api-errors";
import {
  REF_KINDS,
  isBuiltinOption,
  optionColor,
  type OptionColors,
  type RefKind,
} from "@/lib/ref-options";
import { channelLabel, locationLabel, statusLabel } from "@/lib/reporting";
import { refreshOptionColors } from "@/lib/option-colors";

type KindData = { values: string[]; removable: string[]; usage: Record<string, number> };
type Payload = Record<RefKind, KindData> & { colors: OptionColors; role: string | null };
type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Dictionary key prefix for each panel's title. */
const KIND_TITLE: Record<RefKind, string> = {
  statuses: "options.statuses",
  channels: "options.channels",
  locations: "options.locations",
};

export default function OptionsPage() {
  const router = useRouter();
  const { t } = useLang();
  const [user, setUser] = useState<{ name: string; initials: string; role: string } | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [denied, setDenied] = useState(false);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/options", { cache: "no-store" });
    if (!res.ok) {
      showToast("error", apiErrorMessage(t, await readApiError(res)));
      return;
    }
    setData((await res.json()) as Payload);
  }, [showToast, t]);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) {
        router.replace("/login");
        return;
      }
      const d = (await r.json()) as { authenticated: boolean; user?: { name: string; initials: string; role: string } };
      if (!d.authenticated || !d.user) {
        router.replace("/login");
        return;
      }
      setUser(d.user);
      // Not an admin: say so rather than showing a page they cannot use. The
      // API would refuse every action regardless.
      if (d.user.role !== "Admin") {
        setDenied(true);
        return;
      }
      void load();
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("rwaq-dark") === "1") setDarkMode(true);
  }, [router, load]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  if (denied) {
    return (
      <main className="shell">
        <div className="shell-loading">
          <AlertCircle size={40} color="#ef4444" />
          <p>{t("errors.adminOnly")}</p>
          <button className="btn-primary" onClick={() => router.replace("/")}>{t("common.back")}</button>
        </div>
      </main>
    );
  }

  if (!user || !data) return <main className="shell-loading"><div className="spinner" /><p>{t("common.loadingWorkspace")}</p></main>;

  return (
    <main className="shell">
      <AppHeader user={user} active="options" darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />

      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><Settings2 size={14} />{t("options.title")}</div>
            <h1>{t("options.title")}</h1>
            <p>{t("options.subtitle")}</p>
          </div>
        </div>

        <div className="archive-note"><AlertCircle size={14} /> {t("options.hint")}</div>

        {REF_KINDS.map((kind) => (
          <OptionPanel
            key={kind}
            kind={kind}
            data={data[kind]}
            colors={data.colors}
            onChanged={load}
            showToast={showToast}
            t={t}
          />
        ))}
      </div>

      {toast && <div className={`toast toast-${toast.type}`}><span>{toast.message}</span></div>}
    </main>
  );
}

/** One reference list: an add row plus a row per value with a colour picker. */
function OptionPanel({ kind, data, colors, onChanged, showToast, t }: {
  kind: RefKind;
  data: KindData;
  colors: OptionColors;
  onChanged: () => Promise<void> | void;
  showToast: (type: "success" | "error", message: string) => void;
  t: TFn;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#069de3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Inline rename: which row is being edited, and what it is being edited to.
  const [editing, setEditing] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Multi-select for bulk delete. A Set because selection is toggled constantly
  // and an array would re-render every row on each tap.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Same label rules the rest of the app uses, so a built-in city reads as its
  // localized name here exactly as it does in the pickers.
  const lab = (v: string) =>
    kind === "statuses" ? statusLabel(t, v)
    : kind === "channels" ? channelLabel(t, v)
    : locationLabel(t, v);

  const call = async (method: "POST" | "PUT" | "PATCH" | "DELETE", body: Record<string, unknown>) => {
    const res = await fetch("/api/options", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...body }),
    }).catch(() => null);
    if (!res || !res.ok) {
      showToast("error", apiErrorMessage(t, res ? await readApiError(res) : undefined));
      return false;
    }
    // Re-read the lists so usage counts and the colour map stay consistent with
    // what the server now holds, then push the new colours into the shared
    // store so every pill, dot and tag in the app updates.
    await onChanged();
    await refreshOptionColors();
    return true;
  };

  const add = async () => {
    if (busy) return;
    if (label.trim().length < 2) {
      setError(t("options.errNameMin"));
      return;
    }
    setBusy(true);
    setError("");
    if (await call("POST", { label, color })) {
      setLabel("");
      showToast("success", t("options.added", { value: label.trim() }));
    }
    setBusy(false);
  };

  const remove = async (value: string) => {
    const used = data.usage[value] ?? 0;
    // The wording differs by case: removing a value clients still reference is a
    // materially different action, and the API refuses it outright.
    const message = used > 0
      ? t("options.removeUsedConfirm", { value: lab(value), n: used })
      : t("options.removeConfirm", { value: lab(value) });
    if (!confirm(message)) return;
    if (await call("DELETE", { label: value })) {
      showToast("success", t("options.removed", { value: lab(value) }));
    }
  };

  /**
   * Renames a value everywhere it is stored.
   *
   * This rewrites every client row holding the old name, so the confirmation
   * states how many records are about to change — a rename of a widely-used
   * status touches far more data than the single row it was typed into, and
   * that should never be a surprise.
   */
  const startRename = (value: string) => {
    setEditing(value);
    setRenameValue(value);
  };

  const cancelRename = () => {
    setEditing(null);
    setRenameValue("");
  };

  const saveRename = async (value: string) => {
    const next = renameValue.trim();
    if (next.toLowerCase() === value.toLowerCase()) {
      cancelRename();
      return;
    }
    const used = data.usage[value] ?? 0;
    if (!confirm(t("options.renameConfirm", { from: lab(value), to: next, n: used }))) return;
    if (await call("PUT", { label: value, to: next })) {
      showToast("success", t("options.renamed", { from: lab(value), to: next }));
      cancelRename();
    }
  };

  /** Values in this panel that may actually be deleted. */
  const deletable = data.values.filter((v) => !isBuiltinOption(kind, v) && (data.usage[v] ?? 0) === 0);

  const toggleSelected = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === deletable.length ? new Set() : new Set(deletable)));
  };

  /**
   * Deletes every selected value in one request.
   *
   * The endpoint deletes what it can and returns the reason for each refusal
   * rather than failing the batch, so both outcomes are reported here.
   */
  const removeSelected = async () => {
    if (selected.size === 0) return;
    const labels = [...selected];
    const res = await fetch("/api/options", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, labels }),
    }).catch(() => null);
    if (!res || !res.ok) {
      showToast("error", apiErrorMessage(t, res ? await readApiError(res) : undefined));
      return;
    }
    const payload = await res.json().catch(() => ({})) as {
      removed?: string[];
      refused?: Array<{ label: string; reason: string; usage?: number }>;
    };
    const removed = payload.removed ?? [];
    if (removed.length > 0) showToast("success", t("options.bulkRemoved", { n: removed.length }));
    for (const r of payload.refused ?? []) {
      showToast(
        "error",
        r.reason === "inUse"
          ? t("options.removeBlockedUsed", { n: r.usage ?? 0 })
          : r.reason === "builtin"
            ? t("options.removeBlockedBuiltin")
            : t("errors.optionNotFound"),
      );
    }
    setSelected(new Set());
    await onChanged();
    await refreshOptionColors();
  };

  /** The add row: colour swatch + name field + add button. */
  const addRow = (
    <div className="options-add-row">
      <label className="options-color-input" title={t("options.pickColor")}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t("options.pickColor")} />
        <span className="options-color-preview" style={{ background: color }} />
      </label>
      <input
        className="options-name-input"
        value={label}
        onChange={(e) => { setLabel(e.target.value); setError(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
        placeholder={t("options.addPlaceholder")}
        aria-label={t("options.addPlaceholder")}
      />
      <button className="btn-primary" onClick={() => void add()} disabled={busy}>
        {busy ? <Loader2 size={14} className="imp-spin" /> : <Plus size={14} />}
        {t("options.add")}
      </button>
    </div>
  );

  return (
    <section className="panel options-panel">
      <div className="panel-heading">
        <h3>{t(KIND_TITLE[kind])} <small>{t("options.count", { n: data.values.length })}</small></h3>
        {/* Select-all only covers deletable rows: ticking a built-in or an
            in-use value would just produce a refusal on submit. */}
        {deletable.length > 0 && (
          <label className="options-select-all">
            <input
              type="checkbox"
              className="cb"
              checked={selected.size === deletable.length && deletable.length > 0}
              onChange={toggleSelectAll}
              aria-label={t("options.selectAll")}
            />
            <span>{t("options.selectAll")}</span>
          </label>
        )}
        {/* Always visible, not just while something is ticked. It used to live
            only inside the bulk bar, which meant there was no way to reset a
            selection once you unticked the last box by hand. */}
        {selected.size > 0 && (
          <button className="btn-ghost options-clear-selection" onClick={() => setSelected(new Set())}>
            <X size={13} />{t("options.clearSelection")}
          </button>
        )}
      </div>

      {addRow}
      {error && <div className="settings-error">{error}</div>}

      {/* Bulk action bar — only while something is ticked, so it never takes up
          space the admin did not ask for. */}
      {selected.size > 0 && (
        <div className="options-bulk-bar">
          <span>{t("options.selected", { n: selected.size })}</span>
          <div className="options-bulk-actions">
            <button className="btn-danger-outline" onClick={() => void removeSelected()}>
              <Trash2 size={13} />{t("options.bulkDelete", { n: selected.size })}
            </button>
            <button className="btn-ghost" onClick={() => setSelected(new Set())}>
              <X size={13} />{t("common.clear")}
            </button>
          </div>
        </div>
      )}

      <div className="options-list">
        {data.values.length === 0 && <div className="empty-state">{t("options.empty")}</div>}
        {data.values.map((value) => renderValueRow(value))}
      </div>
    </section>
  );

  /** Swatch, name, usage count, and the colour / rename / delete control set. */
  function renderValueRow(value: string) {
    const used = data.usage[value] ?? 0;
    const builtin = isBuiltinOption(kind, value);
    // Only saved values can be deleted, and never one still in use — mirroring
    // the server guards exactly, so the button never promises something the API
    // will refuse.
    const canRemove = !builtin && used === 0;
    const custom = Boolean(colors[kind]?.[value]);
    const swatch = optionColor(kind, value, colors);
    const isEditing = editing === value;
    // Built-in statuses are locked: renaming one would move every client on it
    // out of the won/lost/progress buckets and silently change the reporting.
    const canRename = !(kind === "statuses" && builtin);
    return (
      <div className={`options-row ${selected.has(value) ? "options-row-selected" : ""}`} key={value}>
        <input
          type="checkbox"
          className="cb"
          checked={selected.has(value)}
          disabled={!canRemove}
          onChange={() => toggleSelected(value)}
          aria-label={t("options.selectValue", { value: lab(value) })}
        />
        <span className="options-swatch" style={{ background: swatch }} />
        {isEditing ? (
          /* Inline edit with VISIBLE Save / Cancel.
             Enter saves, Escape cancels and blur saves, but none of that is
             discoverable — the row just looked like it was being renamed with
             no way to commit it. The buttons make the action explicit; the
             keyboard shortcuts are kept as the fast path. */
          <>
            <input
              className="options-name-input options-rename-input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              /* Not onBlur: clicking Save would blur the input first and fire two
                 saves. The buttons handle the commit explicitly instead. */
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename(value);
                if (e.key === "Escape") cancelRename();
              }}
              aria-label={t("options.renameFor", { value: lab(value) })}
            />
            <span className="options-rename-actions">
              <button
                className="btn-sm"
                disabled={renameValue.trim().length < 2 || renameValue.trim() === value.trim()}
                title={t("common.save")}
                onClick={() => void saveRename(value)}
              >
                <Check size={12} />{t("common.save")}
              </button>
              <button className="btn-ghost" onClick={cancelRename} title={t("common.cancel")}>
                <X size={12} />{t("common.cancel")}
              </button>
            </span>
          </>
        ) : (
          <span className="options-label">{lab(value)}</span>
        )}
        {builtin && <span className="options-tag">{t("options.builtin")}</span>}
        <span className="options-usage" title={t("refData.inUseBy", { n: used })}>{t("options.used", { n: used })}</span>
        <span className="options-actions">
          {!isEditing && (
            <button
              className="icon-btn-sm"
              disabled={!canRename}
              title={canRename ? t("options.renameTitle") : t("options.renameBlocked")}
              onClick={() => startRename(value)}
            >
              <Pencil size={13} />
            </button>
          )}
          <label className="options-color-input" title={t("options.pickColor")}>
            <input
              type="color"
              value={swatch}
              onChange={(e) => void call("PATCH", { label: value, color: e.target.value })}
              aria-label={t("options.colorFor", { value: lab(value) })}
            />
            <span className="options-color-preview" style={{ background: swatch }} />
          </label>
          {/* Only rendered once a custom colour is set, so "reset" always has
              something to undo. Sends an explicit null, which the API treats as
              "drop the override" rather than "reject". */}
          {custom && (
            <button
              className="icon-btn-sm"
              title={t("options.resetColorTitle")}
              onClick={() => void call("PATCH", { label: value, color: null })}
            >
              <Check size={13} />
            </button>
          )}
          <button
            className="icon-btn-sm danger"
            disabled={!canRemove}
            title={canRemove
              ? t("options.removeTitle")
              : used > 0
                ? t("options.removeBlockedUsed", { n: used })
                : t("options.removeBlockedBuiltin")}
            onClick={() => void remove(value)}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
    );
  }
}