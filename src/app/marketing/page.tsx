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
import type { MarketingMetric } from "@/lib/marketing";
import "./marketing.css";

type User = { name: string; initials: string; role: string; email?: string };

const CH_COLORS: Record<string, string> = {
  FACEBOOK: "#4f46e5", INSTAGRAM: "#e11d48", X: "#111827", TIKTOK: "#7c3aed",
  GOOGLE_ADS: "#d97706", WHATSAPP: "#16a34a", CALLS: "#ea580c", SALES: "#0891b2",
};
const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];
const CH_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", X: "X", TIKTOK: "TikTok",
  GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", CALLS: "Calls", SALES: "Sales",
};

export default function MarketingPage() {
  const router = useRouter();
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
    if (!form.startDate) errors.startDate = "Required";
    if (!form.endDate) errors.endDate = "Required";
    if (form.startDate && form.endDate && form.startDate > form.endDate) errors.endDate = "Must be after start";
    if (!form.spend && form.spend !== "0") errors.spend = "Required";
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
    if (!confirm("Delete this metric?")) return;
    await fetch("/api/marketing/metrics", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await loadMetrics();
  };

  const totalSpend = useMemo(() => metrics.reduce((s, m) => s + Number(m.spend ?? 0), 0), [metrics]);
  const totalReach = useMemo(() => metrics.reduce((s, m) => s + Number(m.reach ?? 0), 0), [metrics]);
  const totalClicks = useMemo(() => metrics.reduce((s, m) => s + Number(m.clicks ?? 0), 0), [metrics]);
  const avgCPM = totalReach > 0 ? (totalSpend / totalReach * 1000).toFixed(2) : "0";
  const avgCPC = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : "0";

  const monthlyData = useMemo(() => {
    const months = new Map<string, { spend: number; reach: number; clicks: number }>();
    for (const m of metrics) {
      const d = new Date(m.startDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mo = months.get(key) ?? { spend: 0, reach: 0, clicks: 0 };
      mo.spend += Number(m.spend ?? 0); mo.reach += Number(m.reach ?? 0); mo.clicks += Number(m.clicks ?? 0);
      months.set(key, mo);
    }
    return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([period, d]) => ({ period, ...d, label: new Date(period + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }) }));
  }, [metrics]);

  const channelBreakdown = useMemo(() => {
    const map = new Map<string, { spend: number; reach: number; clicks: number }>();
    for (const m of metrics) {
      const ch = map.get(m.channel) ?? { spend: 0, reach: 0, clicks: 0 };
      ch.spend += Number(m.spend ?? 0); ch.reach += Number(m.reach ?? 0); ch.clicks += Number(m.clicks ?? 0);
      map.set(m.channel, ch);
    }
    return [...map.entries()].map(([channel, d]) => ({
      channel, name: CH_LABELS[channel] ?? channel, spend: d.spend, reach: d.reach, clicks: d.clicks,
      cpm: d.reach > 0 ? (d.spend / d.reach * 1000).toFixed(2) : "0", cpc: d.clicks > 0 ? (d.spend / d.clicks).toFixed(2) : "0",
    }));
  }, [metrics]);

  const rankedChannels = useMemo(
    () => channelBreakdown.filter(c => Number(c.cpm) > 0).sort((a, b) => Number(a.cpm) - Number(b.cpm)),
    [channelBreakdown],
  );
  const bestChannel = rankedChannels[0];
  const worstChannel = rankedChannels[rankedChannels.length - 1];
  const bestMonth = useMemo(() => [...monthlyData].sort((a, b) => b.spend - a.spend)[0], [monthlyData]);

  if (!user) return <div className="shell-loading"><div className="spinner"/><p>Loading...</p></div>;

  return (
    <div className="shell marketing-shell">
      <AppHeader user={user} active="marketing" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />

      <div className="content">
        {/* ── Page hero ── */}
        <div className="mkt-hero">
          <div className="mkt-hero-top">
            <div>
              <div className="breadcrumb mkt-crumb"><Layers size={14} />MARKETING WORKSPACE</div>
              <h1>Make every campaign count.</h1>
              <p>Your investment, audience, and channel performance in one place.</p>
              <span className="mkt-period"><Calendar size={13} /> All-time overview</span>
            </div>
            <div className="header-actions">
              <button className="btn-outline mkt-hero-btn" onClick={async () => {
                const csv = [
                  ["Channel","Period","Spend","Reach","Impressions","Clicks","CPM"],
                  ...metrics.map(m => [CH_LABELS[m.channel] ?? m.channel, `${m.startDate} – ${m.endDate}`, m.spend, m.reach, m.impressions, m.clicks, m.reach > 0 ? (m.spend / m.reach * 1000).toFixed(2) : "0"])
                ].map(r => r.map(v => `"${String(v)}"`).join(",")).join("\r\n");
                const link = document.createElement("a");
                link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
                link.download = `marketing-${new Date().toISOString().slice(0,10)}.csv`; link.click();
              }}><Download size={15} />Export</button>
              <button className="btn-primary mkt-hero-primary" onClick={openAdd}><Plus size={15} />Add metric</button>
            </div>
          </div>
          <div className="mkt-hero-stats">
            <div className="mkt-stat"><span>${totalSpend.toLocaleString()}</span><small>Tracked spend</small></div>
            <div className="mkt-stat"><span>{channelBreakdown.length}</span><small>Active channels</small></div>
            <div className="mkt-stat"><span>{totalClicks.toLocaleString()}</span><small>Total clicks</small></div>
            <div className="mkt-stat"><span>{metrics.length}</span><small>Records logged</small></div>
          </div>
        </div>

        {/* ── KPI row ── */}
        {loading
          ? <div className="shell-loading" style={{ minHeight: 60, gridTemplateColumns: "repeat(4,1fr)" }}><div className="spinner" /><p>Loading metrics…</p></div>
          : <>
            <section className="kpi-row">
              <KpiCard label="Total spend" value={`$${totalSpend.toLocaleString()}`} sub={`${metrics.length} records`} accent="#4f46e5" icon={<DollarSign size={14}/>} />
              <KpiCard label="Total reach" value={totalReach.toLocaleString()} sub="Impressions reached" accent="#0891b2" icon={<EyeIcon size={14}/>} />
              <KpiCard label="Avg CPM" value={`$${avgCPM}`} sub="Cost per 1K reach" accent="#f59e0b" icon={<TrendingUp size={14}/>} />
              <KpiCard label="Avg CPC" value={`$${avgCPC}`} sub="Cost per click" accent="#16a34a" icon={<MousePointer size={14}/>} />
            </section>

            {/* ── Insight highlights ── */}
            <section className="mkt-highlights">
              <div className="mkt-highlight mkt-hl-good">
                <span className="mkt-hl-icon"><ArrowDownRight size={16} /></span>
                <div>
                  <small>Most efficient channel</small>
                  <strong>{bestChannel ? bestChannel.name : "—"}</strong>
                  <span>{bestChannel ? `$${bestChannel.cpm} CPM · $${bestChannel.spend.toLocaleString()} spend` : "No data yet"}</span>
                </div>
              </div>
              <div className="mkt-highlight mkt-hl-bad">
                <span className="mkt-hl-icon"><ArrowUpRight size={16} /></span>
                <div>
                  <small>Highest cost channel</small>
                  <strong>{worstChannel && worstChannel !== bestChannel ? worstChannel.name : "—"}</strong>
                  <span>{worstChannel && worstChannel !== bestChannel ? `$${worstChannel.cpm} CPM · $${worstChannel.spend.toLocaleString()} spend` : "Not enough data"}</span>
                </div>
              </div>
              <div className="mkt-highlight">
                <span className="mkt-hl-icon"><Calendar size={16} /></span>
                <div>
                  <small>Peak period</small>
                  <strong>{bestMonth?.label ?? "—"}</strong>
                  <span>{bestMonth ? `$${bestMonth.spend.toLocaleString()} spend` : "No data yet"}</span>
                </div>
              </div>
              <div className="mkt-highlight">
                <span className="mkt-hl-icon"><TrendingUp size={16} /></span>
                <div>
                  <small>Avg cost per 1K reach</small>
                  <strong>${avgCPM}</strong>
                  <span>{`${totalReach.toLocaleString()} reach`}</span>
                </div>
              </div>
            </section>

            <div className="chart-row-2">
              <div className="panel">
                <div className="mkt-chart-heading"><div><span className="mkt-eyebrow">INVESTMENT TREND</span><h3>Spend over time</h3></div><span className="mkt-chart-note">Latest 6 months with records</span></div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData.slice(0, 6).reverse()}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                    <Tooltip formatter={(v) => `$${(v as number).toLocaleString()}`} />
                    <Area type="monotone" dataKey="spend" stroke="#4f46e5" fill="url(#gradSpend)" strokeWidth={2} />
                    <defs><linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f46e5" stopOpacity={.2} /><stop offset="95%" stopColor="#4f46e5" stopOpacity={0} /></linearGradient></defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="panel">
                <div className="mkt-chart-heading"><div><span className="mkt-eyebrow">BUDGET DISTRIBUTION</span><h3>Spend by channel</h3></div><span className="mkt-chart-note">{channelBreakdown.length} channels</span></div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={channelBreakdown.map(c => ({ name: c.name, value: c.spend }))} cx="50%" cy="50%" outerRadius={85} innerRadius={55} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} dataKey="value">
                      {channelBreakdown.map((c, i) => <Cell key={c.channel} fill={CH_COLORS[c.channel] || "#9ca3af"} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `$${(v as number).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Channel breakdown table ── */}
            <section className="panel">
              <h3>Channel breakdown <small>{channelBreakdown.length} channels</small></h3>
              <div className="table-head-row">
                <span>Channel</span><span>Spend</span><span>Reach</span><span>Clicks</span><span>CPM</span><span>CPC</span>
              </div>
              {channelBreakdown.map(c => (
                <div className="table-row" key={c.channel}>
                  <span className="chan-cell"><i className="dot" style={{ background: CH_COLORS[c.channel] }} />{c.name}</span>
                  <span>${c.spend.toLocaleString()}</span><span>{c.reach.toLocaleString()}</span><span>{c.clicks.toLocaleString()}</span>
                  <span className={Number(c.cpm) < 1 ? "good" : Number(c.cpm) < 3 ? "" : "bad"}>${c.cpm}</span>
                  <span>${c.cpc}</span>
                </div>
              ))}
              {channelBreakdown.length === 0 && <div className="empty-state">No channel data yet. Click &quot;Add metric&quot; to record your first entry.</div>}
            </section>

            {/* ── Recent entries ── */}
            <section className="panel">
              <div className="panel-heading">
                <h3>Recent entries</h3>
                <span className="muted" style={{ fontSize: 11 }}>{metrics.length} total</span>
              </div>
              <div className="recent-row recent-head">
                <span /><span>Channel</span><span>Period</span><span>Spend</span><span>Reach</span><span>Notes</span><span />
              </div>
              {metrics.length === 0 && <div className="empty-state">No metrics recorded yet.</div>}
              {metrics.slice(-10).reverse().map(m => (
                <div className="recent-row" key={m.id}>
                  <span className="dot" style={{ background: CH_COLORS[m.channel] }} />
                  <span className="r-channel">{CH_LABELS[m.channel] ?? m.channel}</span>
                  <span className="r-period">{new Date(m.startDate).toLocaleDateString()} — {new Date(m.endDate).toLocaleDateString()}</span>
                  <span className="r-spend">${Number(m.spend).toLocaleString()}</span>
                  <span className="r-reach">{Number(m.reach).toLocaleString()}</span>
                  <span className="muted" style={{ flex: 1 }}>{m.notes ? m.notes.slice(0, 40) : "—"}</span>
                  <div className="r-actions no-detail">
                    <button className="icon-btn-sm" onClick={() => openEdit(m)} title="Edit"><Edit3 size={12} /></button>
                    <button className="icon-btn-sm danger" onClick={() => deleteMetric(m.id)} title="Delete"><Trash2 size={12} /></button>
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
              <h2>{editingId ? "Edit metric" : "Add metric"}</h2>
              <button className="modal-close" onClick={closeForm}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <Field label="Channel">
                  <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value, customChannelName: e.target.value === "__custom__" ? "" : f.customChannelName }))}>
                    {allChannels.map(ch => <option key={ch} value={ch}>{CH_LABELS[ch] ?? ch}</option>)}
                    <option value="__custom__">+ Add custom channel…</option>
                  </select>
                </Field>
                {form.channel === "__custom__" && (
                  <Field label="New channel name">
                    <input placeholder="e.g. LINKEDIN" value={form.customChannelName} onChange={e => setForm(f => ({ ...f, customChannelName: e.target.value.toUpperCase() }))} />
                  </Field>
                )}
                <Field label="Start date"><input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
                <Field label="End date"><input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
                <Field label="Spend ($)"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.spend} onChange={e => setForm(f => ({ ...f, spend: e.target.value }))} /></Field>
                <Field label="Reach"><input type="number" min="0" placeholder="0" value={form.reach} onChange={e => setForm(f => ({ ...f, reach: e.target.value }))} /></Field>
                <Field label="Clicks"><input type="number" min="0" placeholder="0" value={form.clicks} onChange={e => setForm(f => ({ ...f, clicks: e.target.value }))} /></Field>
                <Field label="Impressions"><input type="number" min="0" placeholder="0" value={form.impressions} onChange={e => setForm(f => ({ ...f, impressions: e.target.value }))} /></Field>
                <Field label="Notes" wide>
                  <textarea rows={2} placeholder="Optional notes…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
              {Object.keys(formErrors).length > 0 && (
                <div className="form-errors" style={{ marginTop: 12 }}>
                  {Object.values(formErrors).map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={closeForm}>Cancel</button>
              <button className="btn-primary" onClick={handleSubmit}><Save size={15} />{editingId ? "Save changes" : "Add metric"}</button>
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
