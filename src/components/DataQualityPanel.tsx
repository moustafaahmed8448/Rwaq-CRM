"use client";

/**
 * Data-quality panel.
 *
 * Backs /api/analytics/data-quality. The clients table shows what is stored; it
 * cannot show what is MISSING, so an unusable row stays invisible until someone
 * tries to call it. This lists the gaps grouped by kind, worst first.
 *
 * Each row opens a drill-down list (full sample from the API) with per-list
 * and download-all CSV exports generated in the browser.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Download, UserRound, X } from "lucide-react";

type Group = {
  kind: string;
  count: number;
  sample: Array<{ clientId: string; name: string; detail: string }>;
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** The route's own kind values, so a new one cannot render as a raw token. */
const KINDS = [
  "no_name", "no_phone", "bad_phone", "no_owner", "no_project",
  "no_location", "no_next_action", "unknown_channel", "unknown_status",
] as const;

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const lines = [header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function DataQualityPanel({ t }: { t: TFn; canExport: boolean }) {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; clientCount: number; scanned: number } | null>(null);
  const [error, setError] = useState("");
  const [openKind, setOpenKind] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/analytics/data-quality", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: { issues?: Group[]; total?: number; clientCount?: number; scanned?: number }) => {
        if (!active) return;
        setGroups(d.issues ?? []);
        setMeta({
          total: d.total ?? 0,
          clientCount: d.clientCount ?? 0,
          scanned: d.scanned ?? 0,
        });
      })
      .catch(() => {
        if (active) setError(t("errors.generic"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const openGroup = useMemo(
    () => groups?.find((g) => g.kind === openKind) ?? null,
    [groups, openKind],
  );

  /* Escape closes the drill-down, mirroring the search palette behaviour. */
  useEffect(() => {
    if (!openGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKind(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openGroup]);

  const goToClient = (id: string) => {
    setOpenKind(null);
    router.push(`/clients/${encodeURIComponent(id)}`);
  };

  const kindLabel = (kind: string) =>
    (KINDS as readonly string[]).includes(kind) ? t(`dq.${kind}`) : kind;

  const exportSingle = (group: Group) => {
    downloadCsv(
      `data-quality-${group.kind}.csv`,
      [t("dq.colClient"), t("dq.colDetail"), t("dq.colId")],
      group.sample.map((row) => [row.name || "—", row.detail || "—", row.clientId]),
    );
  };

  const exportAll = () => {
    if (!groups) return;
    downloadCsv(
      "data-quality-all.csv",
      [t("dq.colIssue"), t("dq.colClient"), t("dq.colDetail"), t("dq.colId")],
      groups.flatMap((group) =>
        group.sample.map((row) => [kindLabel(group.kind), row.name || "—", row.detail || "—", row.clientId]),
      ),
    );
  };

  if (error) return <p className="muted" style={{ fontSize: 12 }}>{error}</p>;
  if (!groups || !meta) return <p className="muted" style={{ fontSize: 12 }}>{t("common.loading")}</p>;

  return (
    <section className="panel dq-panel">
      <div className="followup-workspace-head">
        <h3>
          <ClipboardCheck size={15} />
          {t("dq.title")}
        </h3>
        <span className="muted" style={{ fontSize: 11 }}>
          {meta.total > 0
            ? t("dq.subtitle", { n: meta.total, rows: meta.clientCount })
            : t("dq.subtitle", { n: 0, rows: 0 })}
        </span>
      </div>

      {meta.total === 0 ? (
        <p className="muted" style={{ fontSize: 12, padding: "8px 0" }}>{t("dq.clean")}</p>
      ) : (
        <div className="dq-cards">
          {groups.map((group) => (
            <article key={group.kind} className="dq-card">
              <button type="button" className="dq-card-main" onClick={() => setOpenKind(group.kind)}>
                <span className="dq-kind">{kindLabel(group.kind)}</span>
                <span className="dq-count">{group.count}</span>
              </button>
              <p className="dq-sample">
                {group.sample
                  .slice(0, 4)
                  .map((row) => row.detail ? `${row.name} (${row.detail})` : row.name)
                  .join(" · ")}
                {group.sample.length > 4 && ` +${group.count - 4}`}
              </p>
              <div className="dq-card-actions">
                <button type="button" className="btn-outline btn-sm" onClick={() => setOpenKind(group.kind)}>
                  {t("dq.viewList")}
                </button>
                <button type="button" className="btn-outline btn-sm" onClick={() => exportSingle(group)}>
                  <Download size={13} />
                  {t("dq.downloadOne")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="dq-actions">
        {meta.total > 0 && (
          <button type="button" className="btn-outline" onClick={exportAll}>
            <Download size={14} />
            {t("dq.downloadAll")}
          </button>
        )}
        <p className="muted" style={{ fontSize: 11, margin: 0 }}>
          {t("dq.scanned", { n: meta.scanned })}
        </p>
      </div>

      {openGroup && (
        <div className="modal-overlay search-overlay" onClick={() => setOpenKind(null)}>
          <div
            className="search-palette"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={kindLabel(openGroup.kind)}
          >
            <div className="search-input-row">
              <ClipboardCheck size={16} />
              <span className="search-hit-main">
                <b>{kindLabel(openGroup.kind)}</b>
                <span className="search-hit-sub">
                  {t("dq.subtitle", { n: openGroup.count, rows: openGroup.sample.length })}
                </span>
              </span>
              <button type="button" className="icon-btn-sm" aria-label={t("common.close")} onClick={() => setOpenKind(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="search-results">
              {openGroup.count > openGroup.sample.length && (
                <div className="search-note">{t("dq.showingOf", { shown: openGroup.sample.length, n: openGroup.count })}</div>
              )}
              {openGroup.sample.map((row) => (
                <button key={row.clientId} type="button" className="search-hit" onClick={() => goToClient(row.clientId)}>
                  <UserRound size={15} />
                  <span className="search-hit-main">
                    <b>{row.name || "—"}</b>
                    <span className="search-hit-sub">
                      {row.detail || "—"}
                      <span className="ltr-num"> · #{row.clientId}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="dq-palette-footer">
              <button type="button" className="btn-outline btn-sm" onClick={() => exportSingle(openGroup)}>
                <Download size={13} />
                {t("dq.downloadOne")}
              </button>
              <button type="button" className="btn-outline btn-sm" onClick={() => setOpenKind(null)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
