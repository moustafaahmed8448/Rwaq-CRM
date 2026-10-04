"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart as BChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import {
  Plus, Download, Trash2, Edit3, TrendingUp, TrendingDown, DollarSign,
  Eye as EyeIcon, MousePointer, Layers, ArrowUpRight, ArrowDownRight, Calendar,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import MetricFormModal from "@/components/MetricFormModal";
import MultiSelect from "@/components/MultiSelect";
import { useMetricEditor } from "@/lib/use-metric-editor";
import { useMetricSelection } from "@/lib/use-metric-selection";
import { useLang } from "@/lib/i18n";
import type { MarketingMetric } from "@/lib/types";
import { num, sar, dateLocale } from "@/lib/format";
import { channelLabel } from "@/lib/reporting";
import { optionColor } from "@/lib/ref-options";
import { useOptionColors } from "@/lib/option-colors";
import { apiErrorMessage } from "@/lib/api-errors";
import { downloadFile, exportQuery } from "@/lib/download";
import {
  MARKETING_COLUMNS,
  gridTemplate,
  type MarketingColumnKey,
  type ResolvedMarketingColumn,
} from "@/lib/marketing-columns";
import { useColumnLayout } from "@/lib/use-column-layout";
import "./marketing.css";

type User = { name: string; initials: string; role: string; email?: string };

const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];

/**
 * Date windows offered on this page.
 *
 * The same set as the dashboard's rolling presets (minus This week and All
 * time, neither of which makes sense for spend: spend is always dated, so "all
 * time" would be the default anyway and "this week" is just "last 7 days"
 * restated). Kept local rather than imported so this page's list can diverge
 * from the dashboard's without coupling them.
 */
type MarketingPreset = "all" | "today" | "last3" | "last7" | "last14" | "last30" | "last90" | "month" | "year";

interface PresetDef {
  kind: MarketingPreset;
  labelKey: string;
  /** Inclusive first day. Undefined for "all", which has no lower bound. */
  start?: () => string;
  days?: number;
}

/** YYYY-MM-DD in the local calendar — same rule as the dashboard's dayKey. */
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
};

const PRESETS: PresetDef[] = [
  // "All time" FIRST, because PRESETS[0].kind is the default state. It used to
  // default to "today", so the page opened showing one day of spend while the
  // header read as an all-time view.
  { kind: "all", labelKey: "period.all" },
  { kind: "today", labelKey: "period.today" },
  { kind: "last3", labelKey: "period.last3", days: 3 },
  { kind: "last7", labelKey: "period.last7", days: 7 },
  { kind: "last14", labelKey: "period.last14", days: 14 },
  { kind: "last30", labelKey: "period.last30", days: 30 },
  { kind: "last90", labelKey: "period.last90", days: 90 },
  { kind: "month", labelKey: "period.month", start: () => { const d = new Date(); d.setDate(1); return localDay(d); } },
  { kind: "year", labelKey: "period.year", start: () => { const d = new Date(); d.setMonth(0, 1); return localDay(d); } },
];

/**
 * The window a preset resolves to right now.
 *
 * "all" resolves to two empty strings, which the filter reads as "no bounds" —
 * the same signal the cleared-custom-range path produces, so no downstream code
 * needs a special case for it.
 */
function presetRange(p: PresetDef): { from: string; to: string } {
  if (p.kind === "all") return { from: "", to: "" };
  return { from: p.start ? p.start() : daysAgo((p.days ?? 1) - 1), to: "" };
}

export default function MarketingPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [metrics, setMetrics] = useState<MarketingMetric[]>([]);
  /* Entries table paging. Reset to 1 by every filter change below — see
     `resetPage`, which the filter handlers call. */
  const [page, setPage] = useState(1);
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  // Only saved (custom) channels can be deleted; built-ins are code constants.
  const [removableChannels, setRemovableChannels] = useState<string[]>([]);
  const [channelUsage, setChannelUsage] = useState<Record<string, number>>({});
  // Campaign figures are company-wide, so every role can view this page; only an
  // admin may add, edit or delete a metric. The API enforces that too, so this is
  // about matching the UI to what the server will actually allow.
  const canEdit = user?.role === "Admin";
  const [loading, setLoading] = useState(true);
  // Channel colours now resolve through the shared store, so a colour an admin
  // sets on the options page shows on this page's charts and tables too. The
  // page previously carried its own copy of the channel palette.
  const colors = useOptionColors();

  /* ── Filters: preset window + custom range + channel ── */
  // The window is kept as an explicit preset OR a custom range rather than two
  // free date fields alone: a bare pair of inputs cannot say "Today" or
  // "Last 30 days", and this page has been stuck showing a hardcoded "All time"
  // badge while the numbers underneath described whatever range was typed.
  const [preset, setPreset] = useState<MarketingPreset>(PRESETS[0].kind);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [channelFilters, setChannelFilters] = useState<string[]>([]);

  /* ── Entries table layout ──
     Column widths are persisted per user (`marketingColumns` on AppUser) via the
     SAME hook the clients and profile tables use, so drag-to-resize behaves
     identically here and the save is one debounced PATCH rather than a request
     per pixel. Hydrated when /api/auth/me resolves, below. */
  const { columns, commit, hydrate } = useColumnLayout(MARKETING_COLUMNS, "marketingColumns");

  /* ── Row selection ──
     Cross-PAGE rather than per-page: the point of ticking rows is to export or
     delete a specific set, which rarely fits inside one 25-row page. Cleared by
     `resetView` whenever a filter changes, so the count in the bar always
     describes rows you can actually see. */
  const rtl = lang === "ar";

  /* Live drag preview. Widths are applied to `layout` on every pointer move and
     committed once on release, so a drag produces one save instead of one per
     pixel — same split ClientTable uses. */
  const [draft, setDraft] = useState<{ key: MarketingColumnKey; w: number } | null>(null);
  const drag = useRef<{ key: MarketingColumnKey; startX: number; startW: number } | null>(null);

  const loadMetrics = async () => {
    setLoading(true);
    const res = await fetch("/api/marketing/metrics");
    const d = await res.json() as { metrics?: MarketingMetric[] };
    setMetrics(d.metrics ?? []);
    setLoading(false);
  };

  /* Add / edit / delete for a campaign row, and the modal that renders them, both
     moved out to `@/lib/use-metric-editor` and `@/components/MetricFormModal`.
     They lived here and nowhere else, which is exactly why /metrics could list
     the same campaigns with no way to change one. `onChannelsChanged` hands back
     all three channel fields, not just the names, so this page's filter-bar picker
     does not go stale after a channel is created or removed inside the modal. */
  const metricEditor = useMetricEditor({
    t,
    reload: loadMetrics,
    onChannelsChanged: ({ channels, removable, usage }) => {
      setCustomChannels(channels);
      setRemovableChannels(removable);
      setChannelUsage(usage);
    },
  });

  /* Row selection, extracted to `@/lib/use-metric-selection` and shared with
     /metrics. Destructured under the old names so the JSX below is unchanged;
     the two "all" helpers now take the rows to act on, because "select all" means
     all rows ON SCREEN and the hook cannot know what this page is showing. */
  const {
    selectedIds, deleting, toggleSelect, toggleSelectAll, pageAllSelected,
    clearSelection, exportSelected, deleteSelected,
  } = useMetricSelection({ t, reload: loadMetrics });
  useEffect(() => {
    fetch("/api/auth/me").then(async r => {
      if (!r.ok) { router.replace("/login"); return; }
      const d = await r.json();
      if (!d.authenticated) { router.replace("/login"); return; }
      // Viewable by every role: campaign spend and performance are company-wide
      // figures, not per-rep. Writes stay admin-only — the API rejects them and
      // the controls are hidden below.
      setUser(d.user);
      // Adopt this user's saved marketing-column widths, if any.
      hydrate(d.user.marketingColumns);
      await loadMetrics();
      fetch("/api/channels").then(r => r.json()).then(d => { setCustomChannels(d.channels ?? DEFAULT_CHANNELS); setRemovableChannels(d.removable ?? []); setChannelUsage(d.usage ?? {}); }).catch(() => {});
    }).catch(() => {});
    // `hydrate` is a stable useCallback (its only dep is the module-level
    // registry), so listing it costs nothing and keeps the lint honest.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const stored = localStorage.getItem("rwaq-dark");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "1") setDarkMode(true);
  }, [router, hydrate]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);


  const allChannels = [...DEFAULT_CHANNELS, ...customChannels.filter(ch => !DEFAULT_CHANNELS.includes(ch))];

  /* The filter bar's channel picker deletes too, and its failure has to be
     visible: the editor hook's error line only exists while the modal is open, so
     this reports with the same `alert` the export button already uses rather than
     failing silently. All three fields come back on the DELETE response, so one
     request restores the page's channel state — the old inline version blanked
     `removable`/`usage` instead, which is what made the remaining options' trash
     icons disappear after one delete. */
  const removeChannelFromFilter = async (label: string) => {
    const res = await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }).catch(() => null);
    if (!res || !res.ok) {
      alert(t("mkt.saveFailed"));
      return;
    }
    const r = (await res.json().catch(() => ({}))) as {
      channels?: string[];
      removable?: string[];
      usage?: Record<string, number>;
    };
    setCustomChannels(r.channels ?? []);
    setRemovableChannels(r.removable ?? []);
    setChannelUsage(r.usage ?? {});
  };

  // The active window is the preset's, unless the admin typed a custom range —
  // in which case that wins. Typed dates clear the preset highlight so the badge
  // can never claim "Last 30 days" over a range someone set by hand.
  // Memoized because the filter below depends on it, and a fresh object literal
  // on every render would defeat the useMemo entirely.
  // Named `activeWindow`, not `window`, to avoid shadowing the global.
  const activePreset = fromDate || toDate ? null : PRESETS.find((p) => p.kind === preset);
  const activeWindow = useMemo(
    () => (activePreset ? presetRange(activePreset) : { from: fromDate, to: toDate }),
    [activePreset, fromDate, toDate]
  );

  // Everything below (KPIs, charts, tables, export) is derived from the
  // filtered view. A metric is included when its period overlaps the
  // selected range and it matches the selected channel.
  const filteredMetrics = useMemo(() => metrics.filter(m => {
    // Empty array means "every channel". This replaces the old "ALL" string
    // sentinel, which could not express "three channels" at all.
    if (channelFilters.length > 0 && !channelFilters.includes(m.channel)) return false;
    if (activeWindow.from && m.endDate < activeWindow.from) return false;
    if (activeWindow.to && m.startDate > activeWindow.to) return false;
    return true;
  }), [metrics, channelFilters, activeWindow]);

  /* Entries table paging.

     Newest FIRST, which is a behaviour change: this table used to render
     `slice(-10).reverse()`, i.e. only the last ten rows, so anything older was
     unreachable from this page. It is also the order the API returns them in, so
     sorting here rather than reversing per-page keeps page 1 stable no matter
     which page you come back to.

     Slicing in the browser rather than paging the API: the whole point of the
     KPI cards, the two charts and the export is that they describe every matching
     row, so the page already needs the full filtered set in memory. One extra
     slice is free by comparison. */
  const PAGE_SIZE = 25;
  const pagedMetrics = useMemo(() => {
    const sorted = [...filteredMetrics].sort((a, b) => {
      // endDate first so the most recently finished window is on top; id breaks
      // ties because two channels in the same week share both dates, and without
      // it the order would depend on the database's row order.
      const byDate = String(b.endDate).localeCompare(String(a.endDate));
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });
    const start = (page - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [filteredMetrics, page]);
  const totalPages = Math.max(1, Math.ceil(filteredMetrics.length / PAGE_SIZE));

  /**
   * Whether anything is narrowing the view, which gates the clear button.
   *
   * "All time" is the default and always active, so it does NOT count — otherwise
   * the button would be visible on load and would clear nothing.
   */
  const hasFilters = (activePreset?.kind ?? "all") !== "all" || Boolean(fromDate) || Boolean(toDate) || channelFilters.length > 0;

  /**
   * Paging and selection both describe "the view you are looking at", so every
   * filter change resets both together. Keeping them as one helper means a filter
   * added later cannot forget to clear the selection — which is how a bar ends up
   * counting rows nobody can see.
   */
  const resetView = () => {
    setPage(1);
    // `clearSelection`, not the raw setter: the selection moved into
    // `useMetricSelection`, and reaching past it would be the same coupling the
    // extraction was meant to remove.
    clearSelection();
  };

  /** Back to the state the page opens in: all time, all channels, first page. */
  const clearAllFilters = () => {
    setPreset(PRESETS[0].kind);
    setFromDate("");
    setToDate("");
    setChannelFilters([]);
    resetView();
  };

  /* Row selection, extracted to `@/lib/use-metric-selection` and shared with
     /metrics. `pagedMetrics` is passed to the hook's two "all" helpers rather than
     captured, so "select all" keeps meaning all rows ON SCREEN. */

  /* ── Column resizing ─────────────────────────────────────────────────────
     Mirrors ClientTable: preview while dragging, commit once on release. */
  useEffect(() => {
    if (!draft) return;
    // Stop the drag from selecting the row text underneath it.
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => { document.body.style.userSelect = prev; };
  }, [draft]);

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
    const col = columns.find(c => c.key === d.key);
    if (!col) return;
    // In RTL the grid flows right-to-left, so moving the pointer RIGHT NARROWS the
    // column. Without the inversion every drag runs backwards in Arabic — the
    // app's default language.
    const delta = rtl ? d.startX - e.clientX : e.clientX - d.startX;
    setDraft({ key: d.key, w: Math.min(col.max, Math.max(col.min, d.startW + delta)) });
  };

  const endResize = () => {
    const done = draft;
    drag.current = null;
    setDraft(null);
    if (!done) return;
    commit(columns.map(c => (c.key === done.key ? { ...c, w: done.w } : c)));
  };

  /** Double-click a divider to put that column back to its registry default. */
  const resetColumn = (col: ResolvedMarketingColumn) => {
    const def = MARKETING_COLUMNS.find(d => d.key === col.key);
    if (!def || col.locked) return;
    commit(columns.map(c => (c.key === col.key ? { ...c, w: def.w } : c)));
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
    commit(columns.map(c => (c.key === col.key ? { ...c, w: Math.min(col.max, Math.max(col.min, w)) } : c)));
  };

  /** The live drag width, so header and every body row move together. */
  const layout = draft ? columns.map(c => (c.key === draft.key ? { ...c, w: draft.w } : c)) : columns;
  const shown = layout.filter(c => !c.hidden);

  const totalSpend = useMemo(() => filteredMetrics.reduce((s, m) => s + Number(m.spend ?? 0), 0), [filteredMetrics]);
  const totalReach = useMemo(() => filteredMetrics.reduce((s, m) => s + Number(m.reach ?? 0), 0), [filteredMetrics]);
  const totalClicks = useMemo(() => filteredMetrics.reduce((s, m) => s + Number(m.clicks ?? 0), 0), [filteredMetrics]);
  const avgCPM = totalReach > 0 ? (totalSpend / totalReach * 1000).toFixed(2) : "0";
  const avgCPC = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : "0";

  const monthlyData = useMemo(() => {
    const months = new Map<string, { spend: number; reach: number; clicks: number }>();
    for (const m of filteredMetrics) {
      const d = new Date(m.startDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mo = months.get(key) ?? { spend: 0, reach: 0, clicks: 0 };
      mo.spend += Number(m.spend ?? 0); mo.reach += Number(m.reach ?? 0); mo.clicks += Number(m.clicks ?? 0);
      months.set(key, mo);
    }
    return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([period, d]) => ({ period, ...d, label: new Date(period + "-01").toLocaleDateString(dateLocale(lang), { month: "short", year: "numeric" }) }));
  }, [filteredMetrics, lang]);

  const channelBreakdown = useMemo(() => {
    const map = new Map<string, { spend: number; reach: number; clicks: number }>();
    for (const m of filteredMetrics) {
      const ch = map.get(m.channel) ?? { spend: 0, reach: 0, clicks: 0 };
      ch.spend += Number(m.spend ?? 0); ch.reach += Number(m.reach ?? 0); ch.clicks += Number(m.clicks ?? 0);
      map.set(m.channel, ch);
    }
    return [...map.entries()].map(([channel, d]) => ({
      channel, name: channelLabel(t, channel), spend: d.spend, reach: d.reach, clicks: d.clicks,
      cpm: d.reach > 0 ? (d.spend / d.reach * 1000).toFixed(2) : "0", cpc: d.clicks > 0 ? (d.spend / d.clicks).toFixed(2) : "0",
    }));
  }, [filteredMetrics, t]);

  const rankedChannels = useMemo(
    () => channelBreakdown.filter(c => Number(c.cpm) > 0).sort((a, b) => Number(a.cpm) - Number(b.cpm)),
    [channelBreakdown],
  );
  const bestChannel = rankedChannels[0];
  const worstChannel = rankedChannels[rankedChannels.length - 1];
  const bestMonth = useMemo(() => [...monthlyData].sort((a, b) => b.spend - a.spend)[0], [monthlyData]);

  if (!user) return <div className="shell-loading"><div className="spinner" /><p>{t("common.loading")}</p></div>;

  /**
   * One cell of the entries table, keyed by its registry column.
   *
   * A switch over the column KEY rather than a positional list. The previous
   * markup emitted cells in a fixed order and relied on CSS to line them up, so
   * hiding or reordering a column would have shifted every value one cell to the
   * left; with this, the header and the row are driven by the same `shown` list
   * and cannot disagree.
   *
   * Each element carries its own key because the array below is built by `.map`
   * over a function call rather than over JSX.
   */
  const renderCell = (col: ResolvedMarketingColumn, m: MarketingMetric) => {
    const key = col.key;
    switch (key) {
      case "select":
        return (
          <input
            key={key}
            type="checkbox"
            className="cb"
            checked={selectedIds.has(m.id)}
            onChange={() => toggleSelect(m.id)}
            aria-label={t("options.selectValue", { value: m.name || channelLabel(t, m.channel) })}
          />
        );
      case "channel":
        // Channel as a tinted pill rather than a bare dot: at this size a 6px dot
        // carries no label, so the colour read as decoration. The dot still holds
        // the channel's real colour; the tint is fixed so eight brand hues do not
        // make the rows read as unrelated.
        return (
          <span key={key} className="mkt-chan-pill">
            <i className="dot" style={{ background: optionColor("channels", m.channel, colors) }} />
            {channelLabel(t, m.channel)}
          </span>
        );
      case "campaign":
        return <span key={key} className="r-campaign">{m.name || "—"}</span>;
      case "period":
        return (
          <span key={key} className="r-period">
            {new Date(m.startDate).toLocaleDateString(dateLocale(lang))} — {new Date(m.endDate).toLocaleDateString(dateLocale(lang))}
          </span>
        );
      // tabular-nums so digits line up across rows, and both figures
      // right-aligned: they are the two columns being compared.
      case "spend":
        return <span key={key} className="r-num r-spend">{sar(Number(m.spend))}</span>;
      case "reach":
        return <span key={key} className="r-num r-reach">{num(Number(m.reach))}</span>;
      case "notes":
        return <span key={key} className="r-notes muted">{m.notes ? m.notes.slice(0, 40) : "—"}</span>;
      case "actions":
        return (
          <div key={key} className="r-actions no-detail">
            {canEdit && <button className="icon-btn-sm" onClick={() => metricEditor.openEdit(m)} title={t("common.edit")}><Edit3 size={12} /></button>}
            {canEdit && <button className="icon-btn-sm danger" onClick={() => void metricEditor.deleteMetric(m.id)} title={t("common.delete")}><Trash2 size={12} /></button>}
          </div>
        );
      default:
        // Unreachable while the switch covers MarketingColumnKey; returning null
        // keeps a future registry entry from crashing the whole table.
        return null;
    }
  };

  return (
    <div className="shell marketing-shell">
      <AppHeader user={user} active="marketing" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />

      <div className="content">
        {/* ── Page hero ── */}
        <div className="mkt-hero">
          <div className="mkt-hero-top">
            <div>
              <div className="breadcrumb mkt-crumb"><Layers size={14} />{t("mkt.workspace")}</div>
              {/* The headline and sub-headline this block used to carry were pure
                  copy — they restated what the KPI cards below already show. Kept
                  here: the breadcrumb, the period badge, the actions and the four
                  summary stats. */}
              <span className="mkt-period"><Calendar size={13} /> {activePreset ? t(activePreset.labelKey) : t("dash.allTime")}</span>
            </div>
            <div className="header-actions">
              <button className="btn-outline mkt-hero-btn" onClick={() => {
                // Exports the filtered view as a real .xlsx, filtered server-side
                // with the same period-overlap + channel semantics as the UI.
                downloadFile(`/api/export/marketing${exportQuery({
                  // Comma-joined; /api/export/marketing already splits on commas and drops "ALL".
                  channel: channelFilters.length > 0 ? channelFilters.join(",") : undefined,
                  // The preset's window, not just the typed dates — otherwise
                  // "Last 30 days" would export everything while the screen
                  // showed 30 days.
                  from: activeWindow.from || undefined,
                  to: activeWindow.to || undefined,
                })}`, `marketing-${new Date().toISOString().slice(0, 10)}.xlsx`)
                  .catch(() => alert(t("mkt.exportFail")));
              }}><Download size={15} />{t("mkt.exportExcel")}</button>
              {canEdit && <button className="btn-primary mkt-hero-primary" onClick={metricEditor.openAdd}><Plus size={15} />{t("mkt.addMetric")}</button>}
            </div>
          </div>
          <div className="mkt-hero-stats">
            <div className="mkt-stat"><span>{sar(totalSpend)}</span><small>{t("dash.trackedSpend")}</small></div>
            <div className="mkt-stat"><span>{channelBreakdown.length}</span><small>{t("dash.activeChannels")}</small></div>
            <div className="mkt-stat"><span>{num(totalClicks)}</span><small>{t("dash.totalClicks")}</small></div>
            <div className="mkt-stat"><span>{filteredMetrics.length}</span><small>{t("dash.recordsLogged")}</small></div>
          </div>
        </div>

        {/* ── KPI row ── */}
        {loading
          ? <div className="shell-loading" style={{ minHeight: 60, gridTemplateColumns: "repeat(4,1fr)" }}><div className="spinner" /><p>{t("dash.loadingMetrics")}</p></div>
          : <>
            <section className="kpi-row">
              <KpiCard label={t("mkt.totalSpend")} value={sar(totalSpend)} sub={t("dash.kpiRecords", { n: filteredMetrics.length })} accent="#4f46e5" icon={<DollarSign size={14} />} />
              <KpiCard label={t("mkt.totalReach")} value={num(totalReach)} sub={t("dash.kpiReachSub")} accent="#0891b2" icon={<EyeIcon size={14} />} />
              <KpiCard label={t("mkt.avgCpm")} value={sar(avgCPM)} sub={t("dash.kpiCpmSub")} accent="#f59e0b" icon={<TrendingUp size={14} />} />
              <KpiCard label={t("mkt.avgCpc")} value={sar(avgCPC)} sub={t("dash.kpiCpcSub")} accent="#16a34a" icon={<MousePointer size={14} />} />
            </section>

            {/* ── Filters: preset window + custom range + channel ── */}
            <section className="mkt-filters">
              <div className="mkt-filter-field">
                <label>{t("period.label")}</label>
                {/* Preset buttons. Typing a custom range below clears the
                    highlight, so the active window is never ambiguous. */}
                <div className="mkt-presets">
                  {PRESETS.map(p => (
                    <button
                      key={p.kind}
                      type="button"
                      className={`mkt-preset${activePreset?.kind === p.kind ? " active" : ""}`}
                      aria-pressed={activePreset?.kind === p.kind}
                      onClick={() => { setPreset(p.kind); setFromDate(""); setToDate(""); resetView(); }}
                    >
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mkt-filter-field">
                <label>{t("common.from")}</label>
                <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); resetView(); }} />
              </div>
              <div className="mkt-filter-field">
                <label>{t("common.to")}</label>
                <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); resetView(); }} />
              </div>
              <div className="mkt-filter-field">
                <label>{t("form.channel")}</label>
                {/* Same multi-select as the clients page, so picking several
                    channels at once works here too. Empty selection = all. */}
                <MultiSelect
                  label={t("filter.allChannels")}
                  options={allChannels}
                  selected={channelFilters}
                  onChange={v => { setChannelFilters(v); resetView(); }}
                  render={v => channelLabel(t, v)}
                  onRemove={canEdit ? removeChannelFromFilter : undefined}
                  removable={removableChannels}
                  removeUsage={channelUsage}
                  t={t}
                />
              </div>
              {hasFilters && (
                <button className="btn-ghost mkt-filter-clear" onClick={clearAllFilters}>{t("dash.clearFilters")}</button>
              )}
            </section>

            {/* ── Insight highlights ── */}
            <section className="mkt-highlights">
              <div className="mkt-highlight mkt-hl-good">
                <span className="mkt-hl-icon"><ArrowDownRight size={16} /></span>
                <div>
                  <small>{t("dash.bestChannel")}</small>
                  <strong>{bestChannel ? bestChannel.name : "—"}</strong>
                  <span>{bestChannel ? t("dash.cpmSpend", { cpm: sar(bestChannel.cpm), spend: sar(bestChannel.spend) }) : t("common.noData")}</span>
                </div>
              </div>
              <div className="mkt-highlight mkt-hl-bad">
                <span className="mkt-hl-icon"><ArrowUpRight size={16} /></span>
                <div>
                  <small>{t("dash.worstChannel")}</small>
                  <strong>{worstChannel && worstChannel !== bestChannel ? worstChannel.name : "—"}</strong>
                  <span>{worstChannel && worstChannel !== bestChannel ? t("dash.cpmSpend", { cpm: sar(worstChannel.cpm), spend: sar(worstChannel.spend) }) : t("dash.notEnough")}</span>
                </div>
              </div>
              <div className="mkt-highlight">
                <span className="mkt-hl-icon"><Calendar size={16} /></span>
                <div>
                  <small>{t("dash.peakPeriod")}</small>
                  <strong>{bestMonth?.label ?? "—"}</strong>
                  <span>{bestMonth ? t("dash.spendOnly", { spend: sar(bestMonth.spend) }) : t("common.noData")}</span>
                </div>
              </div>
              <div className="mkt-highlight">
                <span className="mkt-hl-icon"><TrendingUp size={16} /></span>
                <div>
                  <small>{t("dash.kpiCpmSub")}</small>
                  <strong>{sar(avgCPM)}</strong>
                  <span>{t("dash.reachCount", { n: num(totalReach) })}</span>
                </div>
              </div>
            </section>

            <div className="chart-row-2" dir="ltr">
              <div className="panel">
                <div className="mkt-chart-heading"><div><span className="mkt-eyebrow">{t("dash.trendEyebrow")}</span><h3>{t("dash.trendTitle")}</h3></div><span className="mkt-chart-note">{t("dash.trendNote")}</span></div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData.slice(0, 6).reverse()}>
                    <CartesianGrid stroke="rgba(19,34,60,.10)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7e8fa0" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#7e8fa0" }} />
                    <Tooltip formatter={(v) => sar(v as number)} />
                    <Area type="monotone" dataKey="spend" stroke="#069de3" fill="url(#gradSpend)" strokeWidth={2} />
                    <defs><linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#069de3" stopOpacity={.26} /><stop offset="95%" stopColor="#069de3" stopOpacity={0} /></linearGradient></defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="panel">
                <div className="mkt-chart-heading"><div><span className="mkt-eyebrow">{t("dash.budgetEyebrow")}</span><h3>{t("dash.budgetTitle")}</h3></div><span className="mkt-chart-note">{t("dash.channelsCount", { n: channelBreakdown.length })}</span></div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={channelBreakdown.map(c => ({ name: c.name, value: c.spend }))} cx="50%" cy="50%" outerRadius={85} innerRadius={55} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} dataKey="value">
                      {channelBreakdown.map((c) => <Cell key={c.channel} fill={optionColor("channels", c.channel, colors)} />)}
                    </Pie>
                    <Tooltip formatter={(v) => sar(v as number)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Channel breakdown table ── */}
            <section className="panel">
              <h3>{t("brk.title")} <small>{t("dash.channelsCount", { n: channelBreakdown.length })}</small></h3>
              <div className="table-head-row">
                <span>{t("dash.thChannel")}</span><span>{t("dash.thSpend")}</span><span>{t("dash.thReach")}</span><span>{t("dash.thClicks")}</span><span>{t("dash.thCpm")}</span><span>{t("dash.thCpc")}</span>
              </div>
              {channelBreakdown.map(c => (
                <div className="table-row" key={c.channel}>
                  <span className="chan-cell"><i className="dot" style={{ background: optionColor("channels", c.channel, colors) }} />{c.name}</span>
                  <span>{sar(c.spend)}</span><span>{num(c.reach)}</span><span>{num(c.clicks)}</span>
                  <span className={Number(c.cpm) < 1 ? "good" : Number(c.cpm) < 3 ? "" : "bad"}>{sar(c.cpm)}</span>
                  <span>{sar(c.cpc)}</span>
                </div>
              ))}
              {channelBreakdown.length === 0 && <div className="empty-state">{t("dash.breakdownEmpty")}</div>}
            </section>

            {/* ── All entries ──
                Was "Recent entries" showing `slice(-10)`: only the newest ten, with
                no way to reach the rest. Every matching row is now reachable, 25
                to a page. */}
            <section className="panel">
              <div className="panel-heading">
                <h3>{t("dash.recentEntries")}</h3>
                <div className="mkt-heading-tools">
                  <span className="muted" style={{ fontSize: 11 }}>{t("common.records", { n: filteredMetrics.length })}</span>
                  {/* Selection bar. Rendered beside the record count only while
                      something is ticked, so the heading is unchanged when there
                      is no selection. Export works for every role (spend data is
                      company-wide); Delete stays behind `canEdit`, matching the
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

              {/* The scroller. `--mr-cols` is the pixel track list derived from the
                  registry, so ONE inline value drives the header and every row — a
                  drag rewrites it and the whole table follows. It lives on the
                  wrapper rather than on each row because custom properties inherit,
                  and because the rows must scroll horizontally together. */}
              <div className="recent-table" style={{ ["--mr-cols" as string]: gridTemplate(layout) }}>
                <div className="recent-row recent-head">
                  {shown.map(col => (
                    <span
                      key={col.key}
                      className={`col-head-cell${col.key === "spend" || col.key === "reach" ? " r-num" : ""}`}
                    >
                      {col.key === "select"
                        ? (
                          <input
                            type="checkbox"
                            className="cb"
                            checked={pageAllSelected(pagedMetrics)}
                            onChange={() => toggleSelectAll(pagedMetrics)}
                            aria-label={t("clients.selectAll")}
                          />
                        )
                        : col.labelKey ? t(col.labelKey) : null}
                      {/* Locked gutters (select, actions) have a fixed width, so
                          there is nothing to resize and no handle to show. */}
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
                  ))}
                </div>
                {filteredMetrics.length === 0 && <div className="empty-state">{t("dash.noMetrics")}</div>}
                {pagedMetrics.map(m => (
                  <div className="recent-row" key={m.id}>
                    {shown.map(col => renderCell(col, m))}
                  </div>
                ))}
              </div>

              {/* Pager. Hidden when everything fits on one page — a "page 1 of 1"
                  control is noise. Reuses the same keys and `.pager` styling as the
                  profile and clients tables rather than inventing a third variant. */}
              {totalPages > 1 && (
                <div className="pager">
                  <button
                    className="btn-outline btn-sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >{t("pager.prev")}</button>
                  <span className="muted">{t("pager.pageOf", { page, count: totalPages })}</span>
                  <button
                    className="btn-outline btn-sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >{t("pager.next")}</button>
                </div>
              )}
            </section>
          </>}
      </div>

      {/* The campaign form itself moved to MetricFormModal, shared with /metrics — the
          markup went across verbatim, so the two pages cannot drift apart. */}
      <MetricFormModal editor={metricEditor} t={t} allChannels={allChannels} canEdit={canEdit} />
    </div>
  );
}

/* ── Sub-components ── */
function KpiCard({ label, value, sub, accent, icon }: { label: string; value: string; sub: string; accent: string; icon?: React.ReactNode }) {
  return (
    <div className="kpi-card" style={{ borderTopColor: accent }}>
      <div className="kpi-label">
        <span style={{ display: "flex", alignItems: "center", gap: 5, color: accent }}>{icon}{label}</span>
        <span className="kpi-dot" style={{ background: accent }} />
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

/**
 * Labelled form field.
 *
 * The validation state has always been keyed by field name (startDate, endDate,
 * spend, …) but was only ever rendered as an anonymous bullet list at the
 * bottom of the modal, so nothing told the user *which* input to fix. `error`
 * now marks the offending control directly: red border, message underneath and
 * aria-invalid for assistive tech.
 *
 * Now `src/components/Field.tsx`, shared with /metrics through MetricFormModal.
 */
