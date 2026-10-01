"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart as BChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import {
  Plus, Download, Trash2, Edit3, X, Save, TrendingUp, TrendingDown, DollarSign,
  Eye as EyeIcon, MousePointer, Layers, ArrowUpRight, ArrowDownRight, Calendar,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import RefPicker from "@/components/RefPicker";
import MultiSelect from "@/components/MultiSelect";
import { useLang } from "@/lib/i18n";
import type { MarketingMetric } from "@/lib/types";
import { num, sar, dateLocale } from "@/lib/format";
import { channelLabel } from "@/lib/reporting";
import { optionColor } from "@/lib/ref-options";
import { useOptionColors } from "@/lib/option-colors";
import { apiErrorMessage } from "@/lib/api-errors";
import { downloadFile, exportQuery } from "@/lib/download";
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
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  // Only saved (custom) channels can be deleted; built-ins are code constants.
  const [removableChannels, setRemovableChannels] = useState<string[]>([]);
  const [channelUsage, setChannelUsage] = useState<Record<string, number>>({});
  const [showForm, setShowForm] = useState(false);
  // Campaign figures are company-wide, so every role can view this page; only an
  // admin may add, edit or delete a metric. The API enforces that too, so this is
  // about matching the UI to what the server will actually allow.
  const canEdit = user?.role === "Admin";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", channel: "FACEBOOK", startDate: "", endDate: "",
    spend: "", reach: "", impressions: "", clicks: "", notes: "",
    customChannelName: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // A failed save used to be completely silent: `if (res.ok)` had no else
  // branch, so a 500 / 409 / 403 looked identical to clicking nothing.
  const [saveError, setSaveError] = useState("");
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

  const loadMetrics = async () => {
    setLoading(true);
    const res = await fetch("/api/marketing/metrics");
    const d = await res.json() as { metrics?: MarketingMetric[] }; 
    setMetrics(d.metrics ?? []);
    setLoading(false);
  };
  useEffect(() => {
    fetch("/api/auth/me").then(async r => {
      if (!r.ok) { router.replace("/login"); return; }
      const d = await r.json();
      if (!d.authenticated) { router.replace("/login"); return; }
      // Viewable by every role: campaign spend and performance are company-wide
      // figures, not per-rep. Writes stay admin-only — the API rejects them and
      // the controls are hidden below.
      setUser(d.user);
      await loadMetrics();
      fetch("/api/channels").then(r => r.json()).then(d => { setCustomChannels(d.channels ?? DEFAULT_CHANNELS); setRemovableChannels(d.removable ?? []); setChannelUsage(d.usage ?? {}); }).catch(() => {});
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const stored = localStorage.getItem("rwaq-dark");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "1") setDarkMode(true);
  }, [router]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);


  const allChannels = [...DEFAULT_CHANNELS, ...customChannels.filter(ch => !DEFAULT_CHANNELS.includes(ch))];
  const openAdd = () => {
    setEditingId(null);
    setForm({ name: "", channel: "FACEBOOK", startDate: "", endDate: "", spend: "", reach: "", impressions: "", clicks: "", notes: "", customChannelName: "" });
    setFormErrors({});
    setSaveError("");
    setShowForm(true);
  };
  const openEdit = (m: MarketingMetric) => {
    setEditingId(m.id);
    setForm({ name: m.name ?? "", channel: m.channel, startDate: m.startDate, endDate: m.endDate, spend: String(m.spend), reach: String(m.reach), impressions: String(m.impressions), clicks: String(m.clicks), notes: m.notes ?? "", customChannelName: "" });
    setFormErrors({});
    setSaveError("");
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setSaveError(""); setFormErrors({}); };

  /** Editing a field clears just that field's error. */
  const clearError = (key: string) => {
    setFormErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
    setSaveError("");
  };

  /** Creates a new channel and returns its stored (upper-cased) value. */
  const addChannel = async (label: string): Promise<string> => {
    const ch = label.trim().toUpperCase().replace(/\s+/g, "_");
    if (!ch) return label;
    await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: ch }) }).catch(() => {});
    const r = await fetch("/api/channels").then((x) => x.json() as { channels?: string[]; removable?: string[]; usage?: Record<string, number> }).catch((): { channels?: string[]; removable?: string[]; usage?: Record<string, number> } => ({}));
    setCustomChannels(r.channels ?? customChannels);
    setRemovableChannels(r.removable ?? []);
    setChannelUsage(r.usage ?? {});
    return ch;
  };

  /**
   * Deletes a saved channel from the reference list.
   *
   * Only admins reach this (the button is not rendered otherwise), and the API
   * independently refuses to delete a built-in or a channel still used by
   * clients — the picker's own `used === 0` gate is the matching UI guard.
   */
  const removeChannel = async (label: string) => {
    const res = await fetch("/api/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }).catch(() => null);
    if (!res || !res.ok) {
      const err = res ? await res.json().catch(() => ({})) : null;
      setSaveError(apiErrorMessage(t, (err as { error?: unknown })?.error));
      return;
    }
    const r = await res.json().catch(() => ({}));
    setCustomChannels(r.channels ?? []);
    setRemovableChannels([]);
    setChannelUsage({});
    // Drop it from the form if it was the selected channel.
    setForm((f) => (f.channel === label ? { ...f, channel: "FACEBOOK" } : f));
  };

  const handleSubmit = async () => {
    // The picker creates custom channels as you type them, so there is no
    // separate "__custom__" branch to resolve here any more.
    const channel = form.channel;
    const errors: Record<string, string> = {};
    if (!form.channel) errors.channel = t("form.required");
    if (!form.startDate) errors.startDate = t("form.required");
    if (!form.endDate) errors.endDate = t("form.required");
    if (form.startDate && form.endDate && form.startDate > form.endDate) errors.endDate = t("form.afterStart");
    if (!form.spend && form.spend !== "0") errors.spend = t("form.required");
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setSaveError(t("form.fixErrors"));
      return;
    }
    setFormErrors({});
    setSaveError("");

    const body = { name: form.name, channel, startDate: form.startDate, endDate: form.endDate, spend: Number(form.spend), reach: Number(form.reach ?? 0), impressions: Number(form.impressions ?? 0), clicks: Number(form.clicks ?? 0), notes: form.notes };

    const res = editingId
      ? await fetch("/api/marketing/metrics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, ...body }) })
      : await fetch("/api/marketing/metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    if (res.ok) {
      await loadMetrics();
      setShowForm(false);
      setSaveError("");
      setForm({ name: "", channel: "FACEBOOK", startDate: "", endDate: "", spend: "", reach: "", impressions: "", clicks: "", notes: "", customChannelName: "" });
      return;
    }

    // The failure branch that used to be missing. Without it a 500, a 409
    // "duplicate metric" and a 403 all looked like clicking nothing happened.
    let detail: unknown;
    try {
      detail = (await res.json()) as { error?: unknown };
    } catch {
      detail = undefined;
    }
    setSaveError(
      typeof (detail as { error?: unknown })?.error === "string"
        ? apiErrorMessage(t, (detail as { error: string }).error)
        : t("mkt.saveFailed"),
    );
  };

  const deleteMetric = async (id: string) => {
    if (!confirm(t("mkt.deleteConfirm"))) return;
    await fetch("/api/marketing/metrics", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await loadMetrics();
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

  /**
   * Whether anything is narrowing the view, which gates the clear button.
   *
   * "All time" is the default and always active, so it does NOT count — otherwise
   * the button would be visible on load and would clear nothing.
   */
  const hasFilters = (activePreset?.kind ?? "all") !== "all" || Boolean(fromDate) || Boolean(toDate) || channelFilters.length > 0;

  /** Back to the state the page opens in: all time, all channels. */
  const clearAllFilters = () => {
    setPreset(PRESETS[0].kind);
    setFromDate("");
    setToDate("");
    setChannelFilters([]);
  };

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

  return (
    <div className="shell marketing-shell">
      <AppHeader user={user} active="marketing" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />

      <div className="content">
        {/* ── Page hero ── */}
        <div className="mkt-hero">
          <div className="mkt-hero-top">
            <div>
              <div className="breadcrumb mkt-crumb"><Layers size={14} />{t("mkt.workspace")}</div>
              <h1>{t("mkt.title")}</h1>
              <p>{t("mkt.sub")}</p>
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
              {canEdit && <button className="btn-primary mkt-hero-primary" onClick={openAdd}><Plus size={15} />{t("mkt.addMetric")}</button>}
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
                      onClick={() => { setPreset(p.kind); setFromDate(""); setToDate(""); }}
                    >
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mkt-filter-field">
                <label>{t("common.from")}</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div className="mkt-filter-field">
                <label>{t("common.to")}</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
              <div className="mkt-filter-field">
                <label>{t("form.channel")}</label>
                {/* Same multi-select as the clients page, so picking several
                    channels at once works here too. Empty selection = all. */}
                <MultiSelect
                  label={t("filter.allChannels")}
                  options={allChannels}
                  selected={channelFilters}
                  onChange={setChannelFilters}
                  render={v => channelLabel(t, v)}
                  onRemove={canEdit ? removeChannel : undefined}
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

            {/* ── Recent entries ── */}
            <section className="panel">
              <div className="panel-heading">
                <h3>{t("dash.recentEntries")}</h3>
                <span className="muted" style={{ fontSize: 11 }}>{t("common.records", { n: filteredMetrics.length })}</span>
              </div>
              <div className="recent-row recent-head">
                <span>{t("dash.thChannel")}</span><span>{t("mkt.campaignName")}</span><span>{t("dash.thPeriod")}</span><span className="r-num">{t("dash.thSpend")}</span><span className="r-num">{t("dash.thReach")}</span><span>{t("dash.thNotes")}</span><span />
              </div>
              {filteredMetrics.length === 0 && <div className="empty-state">{t("dash.noMetrics")}</div>}
              {filteredMetrics.slice(-10).reverse().map(m => (
                <div className="recent-row" key={m.id}>
                  {/* Channel as a tinted pill rather than a bare dot: at this size a
                      6px dot carries no label, so the colour read as decoration. */}
                  <span className="mkt-chan-pill">
                    <i className="dot" style={{ background: optionColor("channels", m.channel, colors) }} />
                    {channelLabel(t, m.channel)}
                  </span>
                  <span className="r-campaign">{m.name || "—"}</span>
                  <span className="r-period">{new Date(m.startDate).toLocaleDateString(dateLocale(lang))} — {new Date(m.endDate).toLocaleDateString(dateLocale(lang))}</span>
                  {/* tabular-nums so digits line up across rows, and both figures
                      right-aligned: they are the two columns being compared. */}
                  <span className="r-num r-spend">{sar(Number(m.spend))}</span>
                  <span className="r-num r-reach">{num(Number(m.reach))}</span>
                  <span className="r-notes muted">{m.notes ? m.notes.slice(0, 40) : "—"}</span>
                  <div className="r-actions no-detail">
                    {canEdit && <button className="icon-btn-sm" onClick={() => openEdit(m)} title={t("common.edit")}><Edit3 size={12} /></button>}
                    {canEdit && <button className="icon-btn-sm danger" onClick={() => deleteMetric(m.id)} title={t("common.delete")}><Trash2 size={12} /></button>}
                  </div>
                </div>
              ))}
            </section>
          </>}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? t("mkt.editMetric") : t("mkt.addMetric")}</h2>
              <button className="modal-close" onClick={closeForm}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <Field label={t("mkt.campaignName")} wide>
                  <input placeholder={t("mkt.campaignNamePh")} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </Field>
                <Field label={t("form.channel")} error={formErrors.channel}>
                  <RefPicker
                    kind="channels"
                    value={form.channel === "__custom__" ? (form.customChannelName || "") : form.channel}
                    options={allChannels}
                    onChange={v => { clearError("channel"); setForm(f => ({ ...f, channel: v, customChannelName: "" })); }}
                    render={v => channelLabel(t, v)}
                    placeholder={t("form.channelPh")}
                    onAdd={addChannel}
                    onRemove={canEdit ? removeChannel : undefined}
                    removable={removableChannels}
                    removeUsage={channelUsage}
                    t={t}
                  />
                </Field>
                <Field label={t("mkt.startDate")} error={formErrors.startDate}><input type="date" value={form.startDate} onChange={e => { clearError("startDate"); setForm(f => ({ ...f, startDate: e.target.value })); }} /></Field>
                <Field label={t("mkt.endDate")} error={formErrors.endDate}><input type="date" value={form.endDate} onChange={e => { clearError("endDate"); setForm(f => ({ ...f, endDate: e.target.value })); }} /></Field>
                <Field label={t("mkt.spend")} error={formErrors.spend}><input type="number" min="0" step="0.01" placeholder="0.00" value={form.spend} onChange={e => { clearError("spend"); setForm(f => ({ ...f, spend: e.target.value })); }} /></Field>
                <Field label={t("mkt.reach")}><input type="number" min="0" placeholder="0" value={form.reach} onChange={e => setForm(f => ({ ...f, reach: e.target.value }))} /></Field>
                <Field label={t("mkt.clicks")}><input type="number" min="0" placeholder="0" value={form.clicks} onChange={e => setForm(f => ({ ...f, clicks: e.target.value }))} /></Field>
                <Field label={t("mkt.impressions")}><input type="number" min="0" placeholder="0" value={form.impressions} onChange={e => setForm(f => ({ ...f, impressions: e.target.value }))} /></Field>
                <Field label={t("mkt.notes")} wide>
                  <textarea rows={2} placeholder={t("mkt.notesPh")} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
              {saveError && (
                <div className="form-errors" style={{ marginTop: 12 }} role="alert">
                  <div>{saveError}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={closeForm}>{t("common.cancel")}</button>
              <button className="btn-primary" onClick={handleSubmit}><Save size={15} />{editingId ? t("common.saveChanges") : t("mkt.addMetric")}</button>
            </div>
          </div>
        </div>
      )}
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
 */
function Field({ label, wide, error, children }: { label: string; wide?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className={`field${wide ? " field-wide" : ""}${error ? " field-invalid" : ""}`}>
      <span>{label}</span>
      {children}
      {error && <em className="field-error">{error}</em>}
    </label>
  );
}
