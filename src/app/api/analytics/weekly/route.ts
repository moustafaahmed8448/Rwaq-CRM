import { NextRequest, NextResponse } from "next/server";
import { demoClients, demoMetrics } from "@/lib/demo-data";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { hasDatabase, prisma } from "@/lib/prisma";
import { channelLabels, endOfWeek, startOfWeek } from "@/lib/reporting";

type ClientRecord = { acquisitionChannel: string; status: string; firstContactPerson: string; secondContactPerson: string };
type MetricRecord = { channel: string; spend?: unknown; reach?: number };

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const from = startOfWeek();
  const to = endOfWeek();
  let metrics: MetricRecord[] = demoMetrics;
  let clients: ClientRecord[] = demoClients;

  if (hasDatabase()) {
    const [databaseMetrics, databaseClients] = await Promise.all([
      prisma.marketingMetric.findMany({ where: { startDate: { gte: from }, endDate: { lte: to } } }),
      prisma.client.findMany({ where: { createdAt: { gte: from, lt: to } } }),
    ]);
    metrics = databaseMetrics;
    clients = databaseClients;
  }

  const rows = Object.keys(channelLabels).map((channel) => {
    const metric = metrics.find((item) => item.channel === channel);
    const channelClients = clients.filter((client) => client.acquisitionChannel === channel);
    const won = channelClients.filter((client) => client.status === "WON").length;
    const lost = channelClients.filter((client) => client.status === "LOST").length;
    const waiting = channelClients.filter((client) => client.status === "WAITING").length;
    const spend = Number(metric?.spend || 0);
    const platform = channelLabels[channel as keyof typeof channelLabels];
    return { channel, platform, channelLabel: platform, spend, reach: Number(metric?.reach || 0), totalClients: channelClients.length, customerCount: channelClients.length, won, lost, waiting, cpa: won ? spend / won : 0 };
  });

  const workload = new Map<string, number>();
  clients.filter((client) => client.status === "WAITING").forEach((client) => {
    workload.set(client.firstContactPerson, (workload.get(client.firstContactPerson) || 0) + 1);
    workload.set(client.secondContactPerson, (workload.get(client.secondContactPerson) || 0) + 1);
  });
  const salespersonLeaderboard = [...workload.entries()].map(([name, activeClients]) => ({ name, activeClients })).sort((a, b) => b.activeClients - a.activeClients);
  const secondSalespersonReport = new Map<string, { won: number; lost: number; waiting: number; total: number }>();
  clients.forEach((client) => {
    const current = secondSalespersonReport.get(client.secondContactPerson) || { won: 0, lost: 0, waiting: 0, total: 0 };
    current.total += 1;
    if (client.status === "WON") current.won += 1;
    if (client.status === "LOST") current.lost += 1;
    if (client.status === "WAITING") current.waiting += 1;
    secondSalespersonReport.set(client.secondContactPerson, current);
  });
  return NextResponse.json({ source: hasDatabase() ? "postgres" : "demo", from, to, rows, salespersonLeaderboard, secondSalespersonReport: [...secondSalespersonReport.entries()].map(([name, values]) => ({ name, ...values })) });
}
