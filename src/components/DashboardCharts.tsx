"use client";

/**
 * Dashboard chart panel.
 *
 * Four views over the same reporting period, chosen with a toggle. Every series
 * is bucketed with the SAME `classifyStatus` the KPI cards use (the numbers
 * arrive pre-bucketed from /api/analytics/weekly), so the chart and the cards
 * can never disagree — which is the bug this replaced.
 *
 * Colour rule: the CHROME (grid, axes, tooltip) wears the brand; the OUTCOME
 * series keep their semantic colours (green/red/amber/grey). Recolouring a "lost"
 * bar azure would destroy the one thing the chart exists to communicate.
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Mirrors statusColor() in reporting.ts, for the charts. */
const OUTCOME = {
  won: "#22c55e",
  lost: "#ef4444",
  waiting: "#f59e0b",
  other: "#94a3b8",
} as const;

const BRAND = "#069de3";
const GRID = "rgba(19,34,60,.10)";
const AXIS = "#7e8fa0";

/** Glass tooltip, so it matches the panels rather than defaulting to white. */
const tooltipStyle = {
  background: "rgba(255,255,255,.9)",
  backdropFilter: "blur(14px)",
  border: "1px solid rgba(255,255,255,.7)",
  borderRadius: 12,
  boxShadow: "0 10px 30px rgba(19,34,60,.18)",
  fontSize: 12,
  color: "#16233a",
} as const;

export type ChartView = "trend" | "outcome" | "channel" | "sales";

export type TrendPoint = {
  key: string; total: number; won: number; lost: number; waiting: number; other: number;
};
export type ChannelPoint = { channel: string; platform: string; totalClients: number; won: number; lost: number; spend: number };
export type SalesPoint = { name: string; won: number; lost: number; waiting: number; other: number; total: number };

const VIEWS: Array<{ id: ChartView; label: string }> = [
  { id: "trend", label: "chart.trend" },
  { id: "outcome", label: "chart.outcome" },
  { id: "channel", label: "chart.channel" },
  { id: "sales", label: "chart.sales" },
];

/** Glass tooltip, so it matches the panels rather than defaulting to white. */

/** Axis label for a trend bucket: "2026-08-14" -> "14 Aug". */
function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${d} ${new Date(y, m - 1, 1).toLocaleString("en", { month: "short" })}`;
}

export default function DashboardCharts({
  view, onViewChange, timeline, channels, sales, t,
}: {
  view: ChartView;
  onViewChange: (v: ChartView) => void;
  timeline: TrendPoint[];
  channels: ChannelPoint[];
  sales: SalesPoint[];
  t: TFn;
}) {
  const empty =
    view === "trend" || view === "outcome" ? timeline.length === 0
      : view === "channel" ? channels.length === 0
        : sales.length === 0;

  return (
    <section className="panel chart-panel">
      <div className="chart-head">
        <div>
          <h3>{t("chart.title")}</h3>
          <p className="chart-sub">{t("chart.subtitle")}</p>
        </div>
        <div className="chart-tabs" role="group" aria-label={t("chart.viewLabel")}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "active" : ""}
              aria-pressed={view === v.id}
              onClick={() => onViewChange(v.id)}
            >{t(v.label)}</button>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="empty-state" style={{ fontSize: 12, padding: "28px 0" }}>{t("chart.noData")}</div>
      ) : (
        <div className="chart-body">
          {view === "trend" && (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={timeline} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gzWon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={OUTCOME.won} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={OUTCOME.won} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="gzLost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={OUTCOME.lost} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={OUTCOME.lost} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="gzWait" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={OUTCOME.waiting} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={OUTCOME.waiting} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="gzOther" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={OUTCOME.other} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={OUTCOME.other} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="key" tickFormatter={shortDay} tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={18} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={false} allowDecimals={false} />
                {/* labelFormatter must tolerate recharts' wider signature; the
                    bucket key is always the string we want to reformat. */}
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(label: unknown) => shortDay(String(label ?? ""))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="won" name={t("stage.won")} stackId="1" stroke={OUTCOME.won} fill="url(#gzWon)" strokeWidth={2} />
                <Area type="monotone" dataKey="lost" name={t("stage.lost")} stackId="1" stroke={OUTCOME.lost} fill="url(#gzLost)" strokeWidth={2} />
                <Area type="monotone" dataKey="waiting" name={t("funnel.inProgress")} stackId="1" stroke={OUTCOME.waiting} fill="url(#gzWait)" strokeWidth={2} />
                <Area type="monotone" dataKey="other" name={t("kpi.otherStatus")} stackId="1" stroke={OUTCOME.other} fill="url(#gzOther)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {view === "outcome" && (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={[
                    { name: t("stage.won"), value: timeline.reduce((s, p) => s + p.won, 0), color: OUTCOME.won },
                    { name: t("funnel.inProgress"), value: timeline.reduce((s, p) => s + p.waiting, 0), color: OUTCOME.waiting },
                    { name: t("stage.lost"), value: timeline.reduce((s, p) => s + p.lost, 0), color: OUTCOME.lost },
                    { name: t("kpi.otherStatus"), value: timeline.reduce((s, p) => s + p.other, 0), color: OUTCOME.other },
                  ].filter((d) => d.value > 0)}
                  cx="50%" cy="50%" outerRadius={96} innerRadius={58}
                  dataKey="value" nameKey="name" paddingAngle={2}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name} ${Math.round((percent ?? 0) * 100)}%`}
                >
                  {[
                    { color: OUTCOME.won }, { color: OUTCOME.waiting },
                    { color: OUTCOME.lost }, { color: OUTCOME.other },
                  ].map((c, i) => <Cell key={i} fill={c.color} stroke="rgba(255,255,255,.6)" />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}

          {view === "channel" && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={channels} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="platform" tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} angle={-12} textAnchor="end" height={54} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(6,157,227,.07)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="totalClients" name={t("chart.clients")} fill={BRAND} radius={[5, 5, 0, 0]} />
                <Bar dataKey="won" name={t("stage.won")} fill={OUTCOME.won} radius={[5, 5, 0, 0]} />
                <Bar dataKey="lost" name={t("stage.lost")} fill={OUTCOME.lost} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {view === "sales" && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sales} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} angle={-12} textAnchor="end" height={54} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(6,157,227,.07)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="won" name={t("stage.won")} fill={OUTCOME.won} radius={[5, 5, 0, 0]} />
                <Bar dataKey="lost" name={t("stage.lost")} fill={OUTCOME.lost} radius={[5, 5, 0, 0]} />
                <Bar dataKey="waiting" name={t("funnel.inProgress")} fill={OUTCOME.waiting} radius={[5, 5, 0, 0]} />
                <Bar dataKey="other" name={t("kpi.otherStatus")} fill={OUTCOME.other} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  );
}

