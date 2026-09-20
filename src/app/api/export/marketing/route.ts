import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listMetrics } from "@/lib/db";
import { parseChannel } from "@/lib/reporting";
import { MONEY_FMT, INT_FMT, buildWorkbook, dateStamp, xlsxResponse, type ExcelColumn } from "@/lib/excel";

const CH_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", X: "X", TIKTOK: "TikTok",
  GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", CALLS: "Calls", SALES: "Sales",
};

const cpm = (spend: number, reach: number) => (reach > 0 ? (spend / reach) * 1000 : 0);
const cpc = (spend: number, clicks: number) => (clicks > 0 ? spend / clicks : 0);

const RECORD_COLUMNS: ExcelColumn[] = [
  { header: "Channel", key: "channel", width: 16 },
  { header: "Start Date", key: "startDate", width: 13 },
  { header: "End Date", key: "endDate", width: 13 },
  { header: "Spend", key: "spend", width: 14, numFmt: MONEY_FMT },
  { header: "Reach", key: "reach", width: 13, numFmt: INT_FMT },
  { header: "Impressions", key: "impressions", width: 14, numFmt: INT_FMT },
  { header: "Clicks", key: "clicks", width: 12, numFmt: INT_FMT },
  { header: "CPM", key: "cpm", width: 12, numFmt: MONEY_FMT },
  { header: "CPC", key: "cpc", width: 12, numFmt: MONEY_FMT },
  { header: "Notes", key: "notes", width: 36 },
];

const SUMMARY_COLUMNS: ExcelColumn[] = [
  { header: "Channel", key: "channel", width: 18 },
  { header: "Records", key: "records", width: 10, numFmt: INT_FMT },
  { header: "Spend", key: "spend", width: 14, numFmt: MONEY_FMT },
  { header: "Reach", key: "reach", width: 13, numFmt: INT_FMT },
  { header: "Impressions", key: "impressions", width: 14, numFmt: INT_FMT },
  { header: "Clicks", key: "clicks", width: 12, numFmt: INT_FMT },
  { header: "CPM", key: "cpm", width: 12, numFmt: MONEY_FMT },
  { header: "CPC", key: "cpc", width: 12, numFmt: MONEY_FMT },
];

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const user = await getSessionUser(request);
  if (user?.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams;
  // parseChannel normalizes known channels/aliases but returns undefined for
  // custom ones — fall back to the normalized raw key so custom-channel
  // filters (e.g. LINKEDIN) still filter instead of being dropped.
  const channels = (q.get("channels") ?? q.get("channel") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => parseChannel(c) ?? c.toUpperCase().replace(/[ /-]+/g, "_"))
    .filter((c) => c !== "ALL");
  const from = q.get("from")?.trim() || undefined;
  const to = q.get("to")?.trim() || undefined;

  try {
    const metrics = await listMetrics({ channels, from, to });

    const records = metrics.map((m) => ({
      channel: CH_LABELS[m.channel] ?? m.channel,
      startDate: m.startDate,
      endDate: m.endDate,
      spend: m.spend,
      reach: m.reach,
      impressions: m.impressions,
      clicks: m.clicks,
      cpm: Number(cpm(m.spend, m.reach).toFixed(2)),
      cpc: Number(cpc(m.spend, m.clicks).toFixed(2)),
      notes: m.notes ?? "",
    }));

    const grouped = new Map<string, { records: number; spend: number; reach: number; impressions: number; clicks: number }>();
    for (const m of metrics) {
      const entry = grouped.get(m.channel) ?? { records: 0, spend: 0, reach: 0, impressions: 0, clicks: 0 };
      entry.records += 1;
      entry.spend += m.spend;
      entry.reach += m.reach;
      entry.impressions += m.impressions;
      entry.clicks += m.clicks;
      grouped.set(m.channel, entry);
    }

    const summary = [...grouped.entries()]
      .sort((a, b) => b[1].spend - a[1].spend)
      .map(([channel, t]) => ({
        channel: CH_LABELS[channel] ?? channel,
        records: t.records,
        spend: t.spend,
        reach: t.reach,
        impressions: t.impressions,
        clicks: t.clicks,
        cpm: Number(cpm(t.spend, t.reach).toFixed(2)),
        cpc: Number(cpc(t.spend, t.clicks).toFixed(2)),
      }));

    const totals = metrics.reduce(
      (acc, m) => {
        acc.spend += m.spend;
        acc.reach += m.reach;
        acc.impressions += m.impressions;
        acc.clicks += m.clicks;
        return acc;
      },
      { spend: 0, reach: 0, impressions: 0, clicks: 0 },
    );

    const period =
      from || to ? `${from ?? "start"} to ${to ?? "today"}` : "All time";

    const buffer = await buildWorkbook([
      {
        name: "Summary",
        columns: SUMMARY_COLUMNS,
        rows: summary,
        totalsRow: {
          channel: `TOTAL — ${period}`,
          records: metrics.length,
          spend: totals.spend,
          reach: totals.reach,
          impressions: totals.impressions,
          clicks: totals.clicks,
          cpm: Number(cpm(totals.spend, totals.reach).toFixed(2)),
          cpc: Number(cpc(totals.spend, totals.clicks).toFixed(2)),
        },
      },
      {
        name: "Records",
        columns: RECORD_COLUMNS,
        rows: records,
      },
    ]);

    return xlsxResponse(buffer, `rwaq-marketing-${dateStamp()}.xlsx`);
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
