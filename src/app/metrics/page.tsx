"use client";

/**
 * The metrics page: every marketing campaign row, as a plain searchable table.
 *
 * /marketing answers "how are we doing" — KPIs, charts, period highlights. This
 * one answers "find me that one campaign": the same rows, no charts, with the
 * free-text search that page never had. Nothing here is editable; the add/edit
 * form stays on /marketing, which is why this grid renders no `actions` gutter
 * and no checkbox column.
 *
 * Filtering is split by cost. Channel and date go to the SERVER, because
 * /api/marketing/metrics already understands `channels` / `from` / `to` and can
 * narrow thousands of rows in the database. The text search stays on the CLIENT,
 * because it has to match across campaign name, channel and notes at once and
 * the API has no parameter for it — round-tripping per keystroke would be worse
 * than filtering the page it already has.
 *
 * Column widths come from the same `MARKETING_COLUMNS` registry /marketing uses,
 * persisted under the same `marketingColumns` blob. Resize a column here and it
 * is already the right width there: one set of numbers, two homes.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Search, Plus, Pencil, Trash2 } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import MultiSelect from "@/components/MultiSelect";
import MetricFormModal from "@/components/MetricFormModal";
import { useMetricEditor } from "@/lib/use-metric-editor";
import { useMetricSelection } from "@/lib/use-metric-selection";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-errors";
import { channelLabel } from "@/lib/reporting";
import { optionColor } from "@/lib/ref-options";
import { useOptionColors } from "@/lib/option-colors";
import { num, sar, dateLocale } from "@/lib/format";
import { downloadFile, exportQuery } from "@/lib/download";
import type { MarketingMetric } from "@/lib/types";
import {
  MARKETING_COLUMNS,
  gridTemplate,
  type ColumnPrefs,
  type MarketingColumnKey,
  type ResolvedMarketingColumn,
} from "@/lib/marketing-columns";
import { useColumnLayout } from "@/lib/use-column-layout";

const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];

type SessionUser = { name: string; initials: string; role: string };

const PAGE_SIZE = 25;

/** YYYY-MM-DD in the LOCAL calendar — same rule as the clients page's `localDay`. */
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Rolling windows offered above the table. */
function datePresets(): Array<{ label: string; from: string }> {
  const daysAgo = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  const firstOfYear = new Date(); firstOfYear.setMonth(0, 1);
  return [
    { label: "date.today", from: daysAgo(0) },
    { label: "date.last7", from: daysAgo(6) },
    { label: "date.last30", from: daysAgo(29) },
    { label: "date.last90", from: daysAgo(89) },
    { label: "date.thisMonth", from: localDay(firstOfMonth) },
    { label: "date.thisYear", from: localDay(firstOfYear) },
  ];
}

type SortKey = "period" | "spend" | "reach";

export default function MetricsPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [metrics, setMetrics] = useState<MarketingMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customChannels, setCustomChannels] = useState<string[]>([]);

  /* ── Filters ── */
  const [query, setQuery] = useState("");
  const [channelFilters, setChannelFilters] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [sortKey, setSortKey] = useState<SortKey>("period");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { columns, commit: setColumns, hydrate } = useColumnLayout(MARKETING_COLUMNS, "marketingColumns");
  const rtl = lang === "ar";
  const colors = useOptionColors();

  // Live drag preview, committed once on release — same split the other grids use.
  const [draft, setDraft] = useState<{ key: MarketingColumnKey; w: number } | null>(null);
  const drag = useRef<{ key: MarketingColumnKey; startX: number; startW: number } | null>(null);

  useEffect(() => {
    if (!draft) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => { document.body.style.userSelect = prev; };
  }, [draft]);

  /* Server-side channel/date filtering. `load` is a useCallback because both the
     channel list and the auth effect below need a stable identity; without it
     the metric fetch would re-run on every render of the parent. */
  const load = useCallback(async (channels: string[], from: string, to: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/marketing/metrics${exportQuery({
        // Comma-joined; the API already splits on commas and ignores blanks.
        channel: channels.length > 0 ? channels.join(",") : undefined,
        from: from || undefined,
        to: to || undefined,
      })}`);
      const d = await res.json() as { metrics?: MarketingMetric[]; error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(t, d.error));
      setMetrics(d.metrics ?? []);
    } catch (e: unknown) {
      setError((e as Error).message);
      setMetrics([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  /* Editing. `guard()` in the API makes EVERY method on /api/marketing/metrics
     admin-only — GET included — so this page is already an admin surface; the UI
     check keeps it honest rather than letting a 403 arrive as a broken button. */
  const canEdit = user?.role === "Admin";

  /* One editor, shared with /marketing: same validation, same request, same error
     text. `reload` replays the filters currently on screen rather than refetching
     everything, so a saved campaign appears where the user was already looking. */
  const metricEditor = useMetricEditor({
    t,
    reload: async () => { await load(channelFilters, fromDate, toDate); },
    onChannelsChanged: ({ channels }) => setCustomChannels(channels),
  });

  /* Row selection, the same hook /marketing uses — so both tables tick, select-all
     and bulk-delete identically instead of /metrics being the read-only one. */
  const {
    selectedIds, deleting, toggleSelect, toggleSelectAll, pageAllSelected,
    clearSelection, exportSelected, deleteSelected,
  } = useMetricSelection({ t, reload: async () => { await load(channelFilters, fromDate, toDate); } });

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) { router.replace("/login"); return; }
      const d = await r.json() as { authenticated: boolean; user?: SessionUser & { marketingColumns?: ColumnPrefs } };
      if (!d.authenticated) { router.replace("/login"); return; }
      setUser(d.user ?? null);
      // Same blob /marketing reads, so a width set on one page applies on both.
      hydrate(d.user?.marketingColumns ?? null);
      // First load, once the session is known to be real.
      await load([], "", "");
    }).catch(() => {});
    const stored = localStorage.getItem("rwaq-dark");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "1") setDarkMode(true);
    fetch("/api/channels").then(r => r.json()).then(d => setCustomChannels(d.channels ?? DEFAULT_CHANNELS)).catch(() => {});
  }, [router, hydrate, load]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  const allChannels = [...DEFAULT_CHANNELS, ...customChannels.filter(ch => !DEFAULT_CHANNELS.includes(ch))];

  /* The three server-side filters re-query through these rather than through an
     effect. An effect would have to call setState synchronously to reset the
     page and kick the fetch, which renders twice on every filter tap and is the
     thing `react-hooks/set-state-in-effect` exists to flag. `query` is applied
     purely on the client, so typing still fires no request. */
  const applyChannels = (v: string[]) => {
    setChannelFilters(v);
    setPage(1);
    void load(v, fromDate, toDate);
  };

  const applyFrom = (v: string) => {
    setActivePreset(null);
    setFromDate(v);
    setPage(1);
    void load(channelFilters, v, toDate);
  };

  const applyTo = (v: string) => {
    setActivePreset(null);
    setToDate(v);
    setPage(1);
    void load(channelFilters, fromDate, v);
  };

  const applyPreset = (label: string, from: string) => {
    setActivePreset(label);
    setFromDate(from);
    setToDate("");
    setPage(1);
    void load(channelFilters, from, "");
  };

  const hasFilters = query.trim() !== "" || channelFilters.length > 0 || fromDate !== "" || toDate !== "";

  const clearAll = () => {
    setQuery("");
    setChannelFilters([]);
    setFromDate("");
    setToDate("");
    setActivePreset(null);
    setPage(1);
    void load([], "", "");
  };

  /* Search + sort run over whatever the server already narrowed to. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? metrics.filter(m =>
        (m.name ?? "").toLowerCase().includes(q) ||
        m.channel.toLowerCase().includes(q) ||
        (m.notes ?? "").toLowerCase().includes(q))
      : metrics;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "spend") return (Number(a.spend) - Number(b.spend)) * dir;
      if (sortKey === "reach") return (Number(a.reach) - Number(b.reach)) * dir;
      // Period sorts by start date; a missing date sorts last either way rather
      // than jumping to the top of the list as an empty string would.
      const av = a.startDate ?? "", bv = b.startDate ?? "";
      if (!av) return 1;
      if (!bv) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [metrics, query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Clamp rather than reset: narrowing a filter should not silently throw the
  // user back to page one, but a page that no longer exists must not render.
  const safePage = Math.min(page, totalPages);
  const paged = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const totalSpend = useMemo(() => visible.reduce((s, m) => s + Number(m.spend ?? 0), 0), [visible]);
  const totalReach = useMemo(() => visible.reduce((s, m) => s + Number(m.reach ?? 0), 0), [visible]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const startResize = (e: React.PointerEvent, col: ResolvedMarketingColumn) => {
    if (col.locked) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key: col.key, startX: e.clientX, startW: col.w };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft({ key: col.key, w: col.w });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // RTL flows right-to-left, so moving the pointer right NARROWS the column.
    const delta = rtl ? d.startX - e.clientX : e.clientX - d.startX;
    const col = columns.find(c => c.key === d.key);
    if (!col) return;
    setDraft({ key: d.key, w: Math.min(col.max, Math.max(col.min, d.startW + delta)) });
  };

  const endResize = () => {
    const done = draft;
    drag.current = null;
    setDraft(null);
    if (!done) return;
    setColumns(columns.map(c => (c.key === done.key ? { ...c, w: done.w } : c)));
  };

  /** Double-click a divider to restore that column's default width. */
  const resetColumn = (col: ResolvedMarketingColumn) => {
    const def = MARKETING_COLUMNS.find(d => d.key === col.key);
    if (!def || col.locked) return;
    setColumns(columns.map(c => (c.key === col.key ? { ...c, w: def.w } : c)));
  };

  const onResizeKey = (e: React.KeyboardEvent, col: ResolvedMarketingColumn) => {
    if (col.locked) return;
    const step = e.shiftKey ? 24 : 8;
    let w: number | null = null;
    if (e.key === "ArrowRight") w = col.w + (rtl ? -step : step);
    else if (e.key === "ArrowLeft") w = col.w + (rtl ? step : -step);
    if (w === null) return;
    e.preventDefault();
    e.stopPropagation();
    setColumns(columns.map(c => (c.key === col.key ? { ...c, w: Math.min(col.max, Math.max(col.min, w)) } : c)));
  };

  const layout = draft ? columns.map(c => (c.key === draft.key ? { ...c, w: draft.w } : c)) : columns;
  /* `select` and `actions` are dropped rather than rendered empty: this page is
     read-only, so a checkbox with no bulk bar and an icon column with no
     handlers would be two controls that do nothing. The template below is built
     from this same list, so the tracks and the cells cannot disagree. */
  /* `select` is in this list again, for the tick column that drives the bulk bar.
     `actions` was the one filtered out until the edit/delete buttons arrived;
     the template below is built from this same list, so a track and its cells
     cannot disagree. */
  const shown = layout.filter(col => !col.hidden);

  const cell = (col: ResolvedMarketingColumn, m: MarketingMetric) => {
    switch (col.key) {
      case "select":
        return (
          <span className="cb-cell">
            <input
              type="checkbox"
              className="cb"
              checked={selectedIds.has(m.id)}
              onChange={() => toggleSelect(m.id)}
              aria-label={t("common.select")}
            />
          </span>
        );
      case "channel":
        return (
          <span className="chan-tag">
            <i className="dot" style={{ background: optionColor("channels", m.channel, colors) }} />
            {channelLabel(t, m.channel)}
          </span>
        );
      case "campaign":
        return <span className="person-cell"><b>{m.name || "—"}</b></span>;
      case "period":
        return (
          <span className="muted">
            {new Date(m.startDate).toLocaleDateString(dateLocale(lang))} → {new Date(m.endDate).toLocaleDateString(dateLocale(lang))}
          </span>
        );
      case "spend":
        return <span className="r-num">{sar(m.spend)}</span>;
      case "reach":
        return <span className="r-num">{num(m.reach)}</span>;
      case "notes":
        return <span className="muted">{m.notes || "—"}</span>;
      /* `.actions-cell` and `.icon-btn-sm` rather than /marketing's `.r-actions`:
         the latter lives in marketing.css, which this page does not load, so the
         buttons would have arrived unstyled here. */
      case "actions":
        return (
          <span className="actions-cell no-detail">
            {canEdit && (
              <button className="icon-btn-sm" onClick={() => metricEditor.openEdit(m)} title={t("common.edit")}>
                <Pencil size={12} />
              </button>
            )}
            {canEdit && (
              <button className="icon-btn-sm danger" onClick={() => void metricEditor.deleteMetric(m.id)} title={t("common.delete")}>
                <Trash2 size={12} />
              </button>
            )}
          </span>
        );
      default:
        return null;
    }
  };

  if (!user) {
    return <main className="shell-loading"><div className="spinner" /></main>;
  }


  return (
    <>
      <AppHeader user={user} active="metrics" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
      <main className="content">
        <div className="page-header">
          <div>
            <h1>{t("metrics.title")}</h1>
            <p>{t("metrics.subtitle")}</p>
          </div>
          <div className="table-actions">
            {/* Creates a campaign. The rows below carry the matching edit/delete,
                so this page can finally manage what it lists. */}
            {canEdit && (
              <button className="btn-primary" onClick={metricEditor.openAdd}>
                <Plus size={15} />{t("mkt.addMetric")}
              </button>
            )}
            {/* Exports what is on screen: the same server-side filters, not the
                whole table. */}
            <button
              className="btn-outline"
              onClick={() => downloadFile(`/api/export/marketing${exportQuery({
                channel: channelFilters.length > 0 ? channelFilters.join(",") : undefined,
                from: fromDate || undefined,
                to: toDate || undefined,
              })}`, `marketing-${localDay(new Date())}.xlsx`).catch(() => setError(t("mkt.exportFail")))}
            >
              <Download size={15} />{t("mkt.exportExcel")}
            </button>
          </div>
        </div>

        {/* Filters — the same controls the clients page offers, narrowed to what a
            campaign row actually has. */}
        <div className="date-presets">
          {datePresets().map(p => (
            <button
              key={p.label}
              className={`date-preset-btn ${activePreset === p.label ? "active" : ""}`}
              onClick={() => applyPreset(p.label, p.from)}
            >
              {t(p.label)}
            </button>
          ))}
          {activePreset && <button className="date-preset-btn" onClick={() => applyFrom("")}>{t("filter.clear")}</button>}
        </div>

        <section className="filter-row">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder={t("metrics.searchPh")}
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1); }}
            />
          </div>
          <MultiSelect
            label={t("filter.allChannels")}
            options={allChannels}
            selected={channelFilters}
            onChange={applyChannels}
            render={v => channelLabel(t, v)}
            t={t}
          />
          <div className="metrics-date">
            <label>{t("common.from")}</label>
            <input type="date" value={fromDate} onChange={e => applyFrom(e.target.value)} />
          </div>
          <div className="metrics-date">
            <label>{t("common.to")}</label>
            <input type="date" value={toDate} onChange={e => applyTo(e.target.value)} />
          </div>
          {hasFilters && (
            <button className="btn-ghost" onClick={clearAll}>{t("dash.clearFilters")}</button>
          )}
        </section>


        <section className="panel">
          <div className="panel-heading">
            <h3>{t("metrics.title")}</h3>
            {/* Right-hand tools, same arrangement as /marketing: the record count,
                then the selection bar beside it. Spend and reach used to be repeated
                here as a caption under the title, which said nothing the KPI cards
                above do not already say. */}
            <div className="mkt-heading-tools">
              <span className="muted" style={{ fontSize: 11 }}>{t("common.records", { n: visible.length })}</span>
              {/* Selection bar, rendered only while something is ticked so the
                  heading is unchanged otherwise. Export works for every role (spend
                  is company-wide); delete stays behind `canEdit`, matching the
                  per-row buttons and the API. */}
              {selectedIds.size > 0 && (
                <div className="mkt-selection">
                  <span className="selection-info">{t("clients.selectedCount", { n: selectedIds.size })}</span>
                  <button type="button" className="btn-outline btn-sm" onClick={exportSelected}>
                    <Download size={13} />{t("mkt.exportSelected")}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn-danger-outline btn-sm"
                      disabled={deleting}
                      onClick={() => void deleteSelected()}
                    >
                      <Trash2 size={13} />{t("mkt.deleteSelected")}
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-sm" onClick={clearSelection}>
                    {t("clients.clearSelection")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {error && <div className="settings-error" style={{ margin: "0 18px 12px" }}>{error}</div>}

          {loading
            ? <div className="shell-loading"><div className="spinner" /></div>
            : <div className="table-scroll-wrapper">
              <div className="client-table" style={{ ["--ct-cols" as string]: gridTemplate(shown) }}>
                <div className="client-row client-head">
                  {shown.map(col => {
                    const sortable = col.key === "period" || col.key === "spend" || col.key === "reach";
                    return (
                      /* `role="columnheader"` on the CELL, not the button: aria-sort is
                         a column-header attribute and is invalid on role=button, which
                         is what the button implicitly has. The cell is the sortable
                         thing as far as assistive tech is concerned. */
                      <span
                        key={col.key}
                        role="columnheader"
                        aria-sort={sortable
                          ? (sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none")
                          : undefined}
                        className={`col-head-cell${col.key === "spend" || col.key === "reach" ? " r-num" : ""}`}
                      >
                        {/* The tick-all box, the same one /marketing uses. "Select
                            all" means all rows on the current page. */}
                        {col.key === "select" ? (
                          <input
                            type="checkbox"
                            className="cb"
                            checked={pageAllSelected(paged)}
                            onChange={() => toggleSelectAll(paged)}
                            aria-label={t("clients.selectAll")}
                          />
                        ) : sortable ? (
                          /* `.col-sort`, not `btn-ghost btn-sm`: globals.css:2327
                             redefines `.btn-sm` to an azure background, which beat
                             `.btn-ghost`'s transparent and painted exactly these
                             three sortable headers blue. */
                          <button
                            type="button"
                            className="col-sort"
                            onClick={() => toggleSort(col.key as SortKey)}
                          >
                            {col.labelKey ? t(col.labelKey) : null}
                            {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        ) : (col.labelKey ? t(col.labelKey) : null)}
                        {!col.locked && (
                          <span
                            className="col-resizer"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t("cols.resize", { name: col.labelKey ? t(col.labelKey) : col.key })}
                            aria-valuenow={col.w}
                            aria-valuemin={col.min}
                            aria-valuemax={col.max}
                            tabIndex={0}
                            title={t("cols.resizeHint")}
                            onPointerDown={e => startResize(e, col)}
                            onPointerMove={onMove}
                            onPointerUp={endResize}
                            onPointerCancel={endResize}
                            onDoubleClick={e => { e.stopPropagation(); resetColumn(col); }}
                            onKeyDown={e => onResizeKey(e, col)}
                          />
                        )}
                      </span>
                    );
                  })}
                </div>
                {paged.map(m => (
                  <div className="client-row" key={m.id}>
                    {/* Keyed Fragment: `cell()` returns an element with no key of
                        its own, so the bare array made React log "Each child in a
                        list should have a unique key". */}
                    {shown.map(col => <Fragment key={col.key}>{cell(col, m)}</Fragment>)}
                  </div>
                ))}
                {visible.length === 0 && <div className="empty-state">{t("dash.noMetrics")}</div>}
              </div>
            </div>}

          {totalPages > 1 && (
            <div className="pager">
              <button className="btn-outline btn-sm" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{t("pager.prev")}</button>
              <span className="muted">{t("pager.pageOf", { page: safePage, count: totalPages })}</span>
              <button className="btn-outline btn-sm" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{t("pager.next")}</button>
            </div>
          )}
        </section>
      </main>

      {/* Same modal /marketing uses, driven by the same hook. */}
      <MetricFormModal editor={metricEditor} t={t} allChannels={allChannels} canEdit={canEdit} />
    </>
  );
}

