import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listMetrics, readSetting } from "@/lib/db";
import {
  channelLabels,
  classifyStatus,
  isInProgress,
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

    // One bucketing pass, reused by every figure below. Classifying per client
    // here (rather than three separate filter passes) keeps the four buckets
    // mutually exclusive and exhaustive, so the cards always sum to the total.
    const bucket = (list: typeof periodClients) => {
      const counts = { won: 0, lost: 0, waiting: 0, other: 0 };
      for (const client of list) {
        switch (classifyStatus(client.status)) {
          case "won": counts.won += 1; break;
          case "lost": counts.lost += 1; break;
          case "progress": counts.waiting += 1; break;
          default: counts.other += 1;
        }
      }
      return counts;
    };

    const rows = [...channelSet].map((channel) => {
      const metric = metrics.find((m) => m.channel === channel);
      const channelClients = periodClients.filter((c) => c.acquisitionChannel === channel);
      // Registry-driven, so a new pipeline stage is picked up automatically
      // instead of silently landing in "other".
      const { won, lost, waiting, other } = bucket(channelClients);
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
        other,
        cpa: won ? spend / won : 0,
      };
    });

    // Campaign names inside this window, for the dashboard's period summary.
    const campaignNames = [...new Set(metrics.map((m) => m.name).filter((n): n is string => Boolean(n)))];

    // Period totals for the KPI cards. The client used to recompute these from
    // the full client list, which silently reverted them to all-time numbers.
    // `other` is what makes won + lost + waiting reconcile to `total`.
    const totals = { total: periodClients.length, ...bucket(periodClients) };

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

    /**
     * Per-salesperson outcome breakdown, per contact ROLE.
     *
     * These two reports used to be merged into one list in the client, which
     * credited a person for a client whether they were the 1st or the 2nd
     * contact — so "your book" and "supporting someone else's" were
     * indistinguishable. Reported separately, a rep's own pipeline and their
     * 2nd-contact support are each readable, and the counts reconcile:
     * won + lost + waiting + other === total for every person.
     */
    const roleReport = (pick: (client: typeof periodClients[number]) => string) => {
      const map = new Map<string, { won: number; lost: number; waiting: number; other: number; total: number }>();
      for (const client of periodClients) {
        const key = pick(client);
        if (!key) continue;
        const row = map.get(key) ?? { won: 0, lost: 0, waiting: 0, other: 0, total: 0 };
        row.total += 1;
        switch (classifyStatus(client.status)) {
          case "won": row.won += 1; break;
          case "lost": row.lost += 1; break;
          case "progress": row.waiting += 1; break;
          default: row.other += 1;
        }
        map.set(key, row);
      }
      // Busiest book first, so the people carrying the most clients are on top.
      return [...map.entries()]
        .map(([name, values]) => ({
          name,
          ...values,
          winRate: values.won + values.lost > 0
            ? Math.round((values.won / (values.won + values.lost)) * 100)
            : null,
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar"));
    };

    const firstSalespersonReport = roleReport((c) => c.firstContactPerson);
    const secondSalespersonReport = roleReport((c) => c.secondContactPerson);

    return NextResponse.json({
      source: "postgres",
      period: { kind: period.kind, from: period.fromStr, to: period.toStr },
      from: period.from,
      to: period.to,
      rows,
      salespersonLeaderboard,
      firstSalespersonReport,
      secondSalespersonReport,
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
