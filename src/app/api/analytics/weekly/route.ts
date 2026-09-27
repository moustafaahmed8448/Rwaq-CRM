import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listMetrics, readSetting } from "@/lib/db";
import {
  channelLabels,
  isInProgress,
  isLost,
  isWon,
  parsePeriodKind,
  resolvePeriod,
} from "@/lib/reporting";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const sessionUser = await getSessionUser(request);
  const q = request.nextUrl.searchParams;

  /**
   * One window drives spend AND client counts.
   *
   * Previously the spend was scoped to the current week while won/lost/waiting
   * came from an unfiltered, all-time client query — so the Avg CPA card divided
   * this week's spend by every client ever won, and the cards sat side by side
   * describing different periods. Both now derive from this single period.
   */
  const period = resolvePeriod(
    parsePeriodKind(q.get("period")),
    q.get("from") ?? undefined,
    q.get("to") ?? undefined,
  );

  try {
    const [metrics, periodClients, allClients, customStatuses, customLocations, customChannels] = await Promise.all([
      listMetrics({ from: period.fromStr, to: period.toStr }),
      // Client counts for the reporting window, still the signed-in user's own.
      listClients({
        includeArchived: true,
        assignee: assigneeScope(sessionUser),
        createdFrom: period.fromStr,
        createdTo: period.toStr,
      }),
      // Unfiltered, used only to build the channel menu: it should still offer
      // every channel in the workspace, not just the ones used this week.
      listClients({ includeArchived: true, assignee: assigneeScope(sessionUser) }),
      readSetting("statuses"),
      readSetting("locations"),
      readSetting("channels"),
    ]);

    // Known channels plus any user-defined or in-use channel.
    const channelSet = new Set<string>([
      ...Object.keys(channelLabels),
      ...customChannels,
      ...allClients.map((c) => c.acquisitionChannel),
      ...metrics.map((m) => m.channel),
    ]);

    const rows = [...channelSet].map((channel) => {
      const metric = metrics.find((m) => m.channel === channel);
      const channelClients = periodClients.filter((c) => c.acquisitionChannel === channel);
      // Registry-driven so a new pipeline stage is picked up automatically
      // instead of silently landing in "waiting".
      const won = channelClients.filter((c) => isWon(c.status)).length;
      const lost = channelClients.filter((c) => isLost(c.status)).length;
      const waiting = channelClients.filter((c) => isInProgress(c.status)).length;
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

    // Campaign names inside this window, for the dashboard's period summary.
    const campaignNames = [...new Set(metrics.map((m) => m.name).filter((n): n is string => Boolean(n)))];

    // Period totals for the KPI cards. The client used to recompute these from
    // the full client list, which silently reverted them to all-time numbers.
    const totals = {
      total: periodClients.length,
      won: periodClients.filter((c) => isWon(c.status)).length,
      lost: periodClients.filter((c) => isLost(c.status)).length,
      waiting: periodClients.filter((c) => isInProgress(c.status)).length,
    };

    const workload = new Map<string, number>();
    periodClients
      .filter((c) => isInProgress(c.status))
      .forEach((c) => {
        workload.set(c.firstContactPerson, (workload.get(c.firstContactPerson) ?? 0) + 1);
        workload.set(c.secondContactPerson, (workload.get(c.secondContactPerson) ?? 0) + 1);
      });
    const salespersonLeaderboard = [...workload.entries()]
      .map(([name, activeClients]) => ({ name, activeClients }))
      .filter((entry) => Boolean(entry.name))
      .sort((a, b) => b.activeClients - a.activeClients);

    const secondSalespersonReport = new Map<string, { won: number; lost: number; waiting: number; total: number }>();
    periodClients.forEach((client) => {
      const key = client.secondContactPerson;
      if (!key) return;
      const current = secondSalespersonReport.get(key) ?? { won: 0, lost: 0, waiting: 0, total: 0 };
      current.total += 1;
      if (isWon(client.status)) current.won += 1;
      if (isLost(client.status)) current.lost += 1;
      if (isInProgress(client.status)) current.waiting += 1;
      secondSalespersonReport.set(key, current);
    });

    return NextResponse.json({
      source: "postgres",
      period: { kind: period.kind, from: period.fromStr, to: period.toStr },
      from: period.from,
      to: period.to,
      rows,
      salespersonLeaderboard,
      secondSalespersonReport: [...secondSalespersonReport.entries()].map(([name, values]) => ({ name, ...values })),
      totalClients: periodClients.length,
      totals,
      campaignNames,
      campaignCount: metrics.length,
      customStatuses,
      customLocations,
      channels: [...channelSet],
      userName: sessionUser?.name ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
