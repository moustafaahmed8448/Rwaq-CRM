import fs from "fs";
import path from "path";

const METRICS_FILE = path.join(process.cwd(), "data", "rwaq-marketing-metrics.json");

export interface MarketingMetric {
  id: string;
  startDate: string;
  endDate: string;
  channel: string;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export function readMetrics(): MarketingMetric[] {
  try {
    const raw = fs.readFileSync(METRICS_FILE, "utf-8");
    return JSON.parse(raw) as MarketingMetric[];
  } catch {
    return [];
  }
}

export function writeMetrics(metrics: MarketingMetric[]) {
  fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

export function getMetricsByWeek(startDate: string): MarketingMetric[] {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return readMetrics().filter(m => {
    const ms = new Date(m.startDate);
    return ms >= start && ms < end;
  });
}

export function getMetricsByMonth(year: number, month: number): MarketingMetric[] {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return readMetrics().filter(m => {
    const ms = new Date(m.startDate);
    return ms >= start && ms < end;
  });
}

export function aggregateByPeriod(metrics: MarketingMetric[], groupBy: "week" | "month") {
  const groups = new Map<string, { spend: number; reach: number; impressions: number; clicks: number; entries: number }>();
  for (const m of metrics) {
    const d = new Date(m.startDate);
    let key: string;
    if (groupBy === "week") {
      const weekStart = new Date(d);
      const day = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - day);
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    const g = groups.get(key) ?? { spend: 0, reach: 0, impressions: 0, clicks: 0, entries: 0 };
    g.spend += Number(m.spend ?? 0);
    g.reach += Number(m.reach ?? 0);
    g.impressions += Number(m.impressions ?? 0);
    g.clicks += Number(m.clicks ?? 0);
    g.entries += 1;
    groups.set(key, g);
  }
  return [...groups.entries()].map(([period, data]) => ({ period, ...data }));
}
