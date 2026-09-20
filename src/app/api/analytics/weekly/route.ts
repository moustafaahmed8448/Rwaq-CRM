import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listMetrics, readSetting } from "@/lib/db";
import { channelLabels, endOfWeek, startOfWeek } from "@/lib/reporting";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const sessionUser = await getSessionUser(request);
  const from = startOfWeek();
  const to = endOfWeek();
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  try {
    const [metrics, clients, customStatuses, customLocations, customChannels] = await Promise.all([
      listMetrics({ from: fromStr, to: toStr }),
      listClients({ includeArchived: true }),
      readSetting("statuses"),
      readSetting("locations"),
      readSetting("channels"),
    ]);

    // Known channels plus any user-defined or in-use channel.
    const channelSet = new Set<string>([
      ...Object.keys(channelLabels),
      ...customChannels,
      ...clients.map((c) => c.acquisitionChannel),
      ...metrics.map((m) => m.channel),
    ]);

    const rows = [...channelSet].map((channel) => {
      const metric = metrics.find((m) => m.channel === channel);
      const channelClients = clients.filter((c) => c.acquisitionChannel === channel);
      const won = channelClients.filter((c) => c.status === "WON").length;
      const lost = channelClients.filter((c) => c.status === "LOST").length;
      const waiting = channelClients.filter((c) => c.status === "WAITING").length;
      const spend = Number(metric?.spend ?? 0);
      const platform = channelLabels[channel] ?? channel;
      return {
        channel,
        platform,
        channelLabel: platform,
        spend,
        reach: Number(metric?.reach ?? 0),
        totalClients: channelClients.length,
        customerCount: channelClients.length,
        won,
        lost,
        waiting,
        cpa: won ? spend / won : 0,
      };
    });

    const workload = new Map<string, number>();
    clients
      .filter((c) => c.status === "WAITING")
      .forEach((c) => {
        workload.set(c.firstContactPerson, (workload.get(c.firstContactPerson) ?? 0) + 1);
        workload.set(c.secondContactPerson, (workload.get(c.secondContactPerson) ?? 0) + 1);
      });
    const salespersonLeaderboard = [...workload.entries()]
      .map(([name, activeClients]) => ({ name, activeClients }))
      .filter((entry) => Boolean(entry.name))
      .sort((a, b) => b.activeClients - a.activeClients);

    const secondSalespersonReport = new Map<string, { won: number; lost: number; waiting: number; total: number }>();
    clients.forEach((client) => {
      const key = client.secondContactPerson;
      if (!key) return;
      const current = secondSalespersonReport.get(key) ?? { won: 0, lost: 0, waiting: 0, total: 0 };
      current.total += 1;
      if (client.status === "WON") current.won += 1;
      if (client.status === "LOST") current.lost += 1;
      if (client.status === "WAITING") current.waiting += 1;
      secondSalespersonReport.set(key, current);
    });

    return NextResponse.json({
      source: "postgres",
      from,
      to,
      rows,
      salespersonLeaderboard,
      secondSalespersonReport: [...secondSalespersonReport.entries()].map(([name, values]) => ({ name, ...values })),
      totalClients: clients.length,
      customStatuses,
      customLocations,
      channels: [...channelSet],
      userName: sessionUser?.name ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}