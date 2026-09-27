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
import { useLang } from "@/lib/i18n";
import type { MarketingMetric } from "@/lib/types";
import { sar, dateLocale } from "@/lib/format";
import { channelLabel } from "@/lib/reporting";
import { downloadFile, exportQuery } from "@/lib/download";
import "./marketing.css";

type User = { name: string; initials: string; role: string; email?: string };

const CH_COLORS: Record<string, string> = {
  FACEBOOK: "#4f46e5", INSTAGRAM: "#e11d48", X: "#111827", TIKTOK: "#7c3aed",
  GOOGLE_ADS: "#d97706", WHATSAPP: "#16a34a", CALLS: "#ea580c", SALES: "#0891b2",
};
const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];

export default function MarketingPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [metrics, setMetrics] = useState<MarketingMetric[]>([]);
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    channel: "FACEBOOK", startDate: "", endDate: "",
    spend: "", reach: "", impressions: "", clicks: "", notes: "",
    customChannelName: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  /* ── Filters: date range + channel ── */
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");

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
      if (d.user?.role !== "Admin") { router.replace("/"); return; }
      setUser(d.user);
      await loadMetrics();
      fetch("/api/channels").then(r => r.json()).then(d => setCustomChannels(d.channels ?? DEFAULT_CHANNELS)).catch(() => {});
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
    setForm({ channel: "FACEBOOK", startDate: "", endDate: "", spend: "", reach: "", impressions: "", clicks: "", notes: "", customChannelName: "" });
    setFormErrors({});
    setShowForm(true);
  };
  const openEdit = (m: MarketingMetric) => {
    setEditingId(m.id);
    setForm({ channel: m.channel, startDate: m.startDate, endDate: m.endDate, spend: String(m.spend), reach: String(m.reach), impressions: String(m.impressions), clicks: String(m.clicks), notes: m.notes ?? "", customChannelName: "" });
    setFormErrors({});
    setShowForm(true);
  };
  const closeForm = () => setShowForm(false);

  const handleSubmit = async () => {
    let channel = form.channel;
    if (channel === "__custom__" && form.customChannelName.trim()) {
      const ch = form.customChannelName.trim().toUpperCase().replace(/\s+/g, "_");
      try { await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: ch }) }); } catch {}
      const r = await fetch("/api/channels").then(x => x.json() as { channels?: string[] }); setCustomChannels(r.channels ?? customChannels);
      channel = ch;
    }
    const errors: Record<string, string> = {};
    if (!form.startDate) errors.startDate = t("form.required");
    if (!form.endDate) errors.endDate = t("form.required");
    if (form.startDate && form.endDate && form.startDate > form.endDate) errors.endDate = t("form.afterStart");
    if (!form.spend && form.spend !== "0") errors.spend = t("form.required");
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    setFormErrors({});

    const body = { channel, startDate: form.startDate, endDate: form.endDate, spend: Number(form.spend), reach: Number(form.reach ?? 0), impressions: Number(form.impressions ?? 0), clicks: Number(form.clicks ?? 0), notes: form.notes };

    const res = editingId
      ? await fetch("/api/marketing/metrics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, ...body }) })
      : await fetch("/api/marketing/metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    if (res.ok) {
      await loadMetrics();
      setShowForm(false);
      setForm({ channel: "FACEBOOK", startDate: "", endDate: "", spend: "", reach: "", impressions: "", clicks: "", notes: "", customChannelName: "" });
    }
  };

  const deleteMetric = async (id: string) => {
    if (!confirm(t("mkt.deleteConfirm"))) return;
    await fetch("/api/marketing/metrics", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await loadMetrics();
  };

  // Everything below (KPIs, charts, tables, export) is derived from the
  // filtered view. A metric is included when its period overlaps the
  // selected range and it matches the selected channel.
  const filteredMetrics = useMemo(() => metrics.filter(m => {
    if (channelFilter !== "ALL" && m.channel !== channelFilter) return false;
    if (fromDate && m.endDate < fromDate) return false;
    if (toDate && m.startDate > toDate) return false;
    return true;
  }), [metrics, channelFilter, fromDate, toDate]);

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
              <span className="mkt-period"><Calendar size={13} /> {t("dash.allTime")}</span>
            </div>
            <div className="header-actions">
              <button className="btn-outline mkt-hero-btn" onClick={() => {
                // Exports the filtered view as a real .xlsx, filtered server-side
                // with the same period-overlap + channel semantics as the UI.
                downloadFile(`/api/export/marketing${exportQuery({
                  channel: channelFilter !== "ALL" ? channelFilter : undefined,
                  from: fromDate || undefined,
                  to: toDate || undefined,
                })}`, `marketing-${new Date().toISOString().slice(0, 10)}.xlsx`)
                  .catch(() => alert(t("mkt.exportFail")));
              }}><Download size={15} />{t("mkt.exportExcel")}</button>
              <button className="btn-primary mkt-hero-primary" onClick={openAdd}><Plus size={15} />{t("mkt.addMetric")}</button>
            </div>
          </div>
          <div className="mkt-hero-stats">
            <div className="mkt-stat"><span>{sar(totalSpend)}</span><small>{t("dash.trackedSpend")}</small></div>
            <div className="mkt-stat"><span>{channelBreakdown.length}</span><small>{t("dash.activeChannels")}</small></div>
            <div className="mkt-stat"><span>{totalClicks.toLocaleString()}</span><small>{t("dash.totalClicks")}</small></div>
            <div className="mkt-stat"><span>{filteredMetrics.length}</span><small>{t("dash.recordsLogged")}</small></div>
          </div>
        </div>

        {/* ── KPI row ── */}
        {loading
          ? <div className="shell-loading" style={{ minHeight: 60, gridTemplateColumns: "repeat(4,1fr)" }}><div className="spinner" /><p>{t("dash.loadingMetrics")}</p></div>
          : <>
            <section className="kpi-row">
              <KpiCard label={t("mkt.totalSpend")} value={sar(totalSpend)} sub={t("dash.kpiRecords", { n: filteredMetrics.length })} accent="#4f46e5" icon={<DollarSign size={14} />} />
              <KpiCard label={t("mkt.totalReach")} value={totalReach.toLocaleString()} sub={t("dash.kpiReachSub")} accent="#0891b2" icon={<EyeIcon size={14} />} />
              <KpiCard label={t("mkt.avgCpm")} value={sar(avgCPM)} sub={t("dash.kpiCpmSub")} accent="#f59e0b" icon={<TrendingUp size={14} />} />
              <KpiCard label={t("mkt.avgCpc")} value={sar(avgCPC)} sub={t("dash.kpiCpcSub")} accent="#16a34a" icon={<MousePointer size={14} />} />
            </section>

            {/* ── Filters: date range + channel ── */}
            <section className="mkt-filters">
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
                <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
                  <option value="ALL">{t("ch.all")}</option>
                  {allChannels.map(ch => <option key={ch} value={ch}>{channelLabel(t, ch)}</option>)}
                </select>
              </div>
              {(fromDate || toDate || channelFilter !== "ALL") && (
                <button className="btn-ghost mkt-filter-clear" onClick={() => { setFromDate(""); setToDate(""); setChannelFilter("ALL"); }}>{t("dash.clearFilters")}</button>
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
                  <span>{t("dash.reachCount", { n: totalReach.toLocaleString() })}</span>
                </div>
              </div>
            </section>

            <div className="chart-row-2" dir="ltr">
              <div className="panel">
                <div className="mkt-chart-heading"><div><span className="mkt-eyebrow">{t("dash.trendEyebrow")}</span><h3>{t("dash.trendTitle")}</h3></div><span className="mkt-chart-note">{t("dash.trendNote")}</span></div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData.slice(0, 6).reverse()}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                    <Tooltip formatter={(v) => sar(v as number)} />
                    <Area type="monotone" dataKey="spend" stroke="#4f46e5" fill="url(#gradSpend)" strokeWidth={2} />
                    <defs><linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f46e5" stopOpacity={.2} /><stop offset="95%" stopColor="#4f46e5" stopOpacity={0} /></linearGradient></defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="panel">
                <div className="mkt-chart-heading"><div><span className="mkt-eyebrow">{t("dash.budgetEyebrow")}</span><h3>{t("dash.budgetTitle")}</h3></div><span className="mkt-chart-note">{t("dash.channelsCount", { n: channelBreakdown.length })}</span></div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={channelBreakdown.map(c => ({ name: c.name, value: c.spend }))} cx="50%" cy="50%" outerRadius={85} innerRadius={55} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} dataKey="value">
                      {channelBreakdown.map((c, i) => <Cell key={c.channel} fill={CH_COLORS[c.channel] || "#9ca3af"} />)}
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
                  <span className="chan-cell"><i className="dot" style={{ background: CH_COLORS[c.channel] }} />{c.name}</span>
                  <span>{sar(c.spend)}</span><span>{c.reach.toLocaleString()}</span><span>{c.clicks.toLocaleString()}</span>
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
                <span /><span>{t("dash.thChannel")}</span><span>{t("dash.thPeriod")}</span><span>{t("dash.thSpend")}</span><span>{t("dash.thReach")}</span><span>{t("dash.thNotes")}</span><span />
              </div>
              {filteredMetrics.length === 0 && <div className="empty-state">{t("dash.noMetrics")}</div>}
              {filteredMetrics.slice(-10).reverse().map(m => (
                <div className="recent-row" key={m.id}>
                  <span className="dot" style={{ background: CH_COLORS[m.channel] }} />
                  <span className="r-channel">{channelLabel(t, m.channel)}</span>
                  <span className="r-period">{new Date(m.startDate).toLocaleDateString(dateLocale(lang))} — {new Date(m.endDate).toLocaleDateString(dateLocale(lang))}</span>
                  <span className="r-spend">{sar(Number(m.spend))}</span>
                  <span className="r-reach">{Number(m.reach).toLocaleString()}</span>
                  <span className="muted" style={{ flex: 1 }}>{m.notes ? m.notes.slice(0, 40) : "—"}</span>
                  <div className="r-actions no-detail">
                    <button className="icon-btn-sm" onClick={() => openEdit(m)} title={t("common.edit")}><Edit3 size={12} /></button>
                    <button className="icon-btn-sm danger" onClick={() => deleteMetric(m.id)} title={t("common.delete")}><Trash2 size={12} /></button>
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
                <Field label={t("form.channel")}>
                  <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value, customChannelName: e.target.value === "__custom__" ? "" : f.customChannelName }))}>
                    {allChannels.map(ch => <option key={ch} value={ch}>{channelLabel(t, ch)}</option>)}
                    <option value="__custom__">{t("mkt.addCustom")}</option>
                  </select>
                </Field>
                {form.channel === "__custom__" && (
                  <Field label={t("mkt.newChannel")}>
                    <input placeholder={t("mkt.newChannelPh")} value={form.customChannelName} onChange={e => setForm(f => ({ ...f, customChannelName: e.target.value.toUpperCase() }))} />
                  </Field>
                )}
                <Field label={t("mkt.startDate")}><input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
                <Field label={t("mkt.endDate")}><input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
                <Field label={t("mkt.spend")}><input type="number" min="0" step="0.01" placeholder="0.00" value={form.spend} onChange={e => setForm(f => ({ ...f, spend: e.target.value }))} /></Field>
                <Field label={t("mkt.reach")}><input type="number" min="0" placeholder="0" value={form.reach} onChange={e => setForm(f => ({ ...f, reach: e.target.value }))} /></Field>
                <Field label={t("mkt.clicks")}><input type="number" min="0" placeholder="0" value={form.clicks} onChange={e => setForm(f => ({ ...f, clicks: e.target.value }))} /></Field>
                <Field label={t("mkt.impressions")}><input type="number" min="0" placeholder="0" value={form.impressions} onChange={e => setForm(f => ({ ...f, impressions: e.target.value }))} /></Field>
                <Field label={t("mkt.notes")} wide>
                  <textarea rows={2} placeholder={t("mkt.notesPh")} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
              {Object.keys(formErrors).length > 0 && (
                <div className="form-errors" style={{ marginTop: 12 }}>
                  {Object.values(formErrors).map((e, i) => <div key={i}>• {e}</div>)}
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

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (<label className={wide ? "field field-wide" : "field"}><span>{label}</span>{children}</label>);
}
