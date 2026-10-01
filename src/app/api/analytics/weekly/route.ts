import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listMetrics, readSetting } from "@/lib/db";
import {
  channelLabels,
  classifyStatus,
  isInProgress,
  parsePeriodKind,
  PREDEFINED_STATUSES,
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
      // Deliberately NOT includeArchived: an archived client is out of the book, so
      // counting it inflated every figure on this page — the KPI cards, the stage
      // panel, the funnel, the location and channel bars, the timeline and the
      // salesperson reports all derive from this one array. This is the only
      // change needed to exclude them from all of them at once.
      listClients({
        assignee: assigneeScope(sessionUser),
        createdFrom: period.fromStr,
        createdTo: period.toStr,
      }),
      // Unfiltered, used only to build the channel menu: it should still offer
      // every channel in the workspace, not just the ones used this week — and
      // keeps archived rows on purpose, so archiving the last client on a channel
      // does not make that channel vanish from the dropdown.
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

    /**
     * Per-status counts INSIDE the period.
     *
     * The dashboard's stage panel, funnel and conversion rate used to recompute
     * these in the browser from the full client list, so selecting "this week"
     * changed the seven KPI cards and left the funnel, stage bars and location
     * panel describing all time — the two halves of one screen disagreeing.
     * Counting here means every section describes the same window.
     *
     * Every status is pre-seeded to 0 so a stage with no clients in the window
     * still renders its row at zero, rather than vanishing from the funnel and
     * making the pass-rate chain unreadable.
     */
    const statusCounts: Record<string, number> = {};
    for (const stage of PREDEFINED_STATUSES) statusCounts[stage] = 0;
    for (const custom of customStatuses) if (!statusCounts[custom]) statusCounts[custom] = 0;
    for (const client of periodClients) {
      const key = client.status;
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }

    /** Per-location counts inside the period, for the "top locations" panel. */
    const locationCounts: Record<string, number> = {};
    for (const client of periodClients) {
      const key = client.location;
      if (key) locationCounts[key] = (locationCounts[key] ?? 0) + 1;
    }

    /** Per-channel counts inside the period, for the channel breakdown panel. */
    const channelCounts: Record<string, number> = {};
    for (const client of periodClients) {
      const key = client.acquisitionChannel;
      if (key) channelCounts[key] = (channelCounts[key] ?? 0) + 1;
    }

    /**
     * Outcome-split timeline for the dashboard trend chart.
     *
     * Buckets the period's clients by WEEK and splits each bucket with the same
     * `classifyStatus` the KPI cards use, so the chart and the cards can never
     * disagree. Local-day keys, not toISOString(): the same UTC trap documented
     * on `dayKey` in reporting.ts would push every client a day to the left for
     * anyone east of Greenwich.
     */
    const timeline = (() => {
      // Anchor the series to the DATA, not to the period start. "All time"
      // resolves to the 1970 epoch, which produced a chart that opened with two
      // decades of empty buckets before the first real client.
      const stamps = periodClients
        .map((c) => new Date(c.createdAt))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
      if (stamps.length === 0) return [];

      const first = new Date(Math.min(...stamps));
      const last = new Date(Math.max(...stamps));
      const days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000) + 1);
      // Long ranges get many empty buckets; cap the count so the chart stays
      // readable and the payload small.
      const stepDays = Math.max(1, Math.ceil(days / 26));
      const buckets: Array<{ key: string; total: number; won: number; lost: number; waiting: number; other: number }> = [];
      const index = new Map<string, (typeof buckets)[number]>();
      for (let offset = 0; offset < days; offset += stepDays) {
        const bucketStart = new Date(first);
        bucketStart.setDate(bucketStart.getDate() + offset);
        const key = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}-${String(bucketStart.getDate()).padStart(2, "0")}`;
        const row = { key, total: 0, won: 0, lost: 0, waiting: 0, other: 0 };
        buckets.push(row);
        index.set(key, row);
      }
      for (const client of periodClients) {
        const d = new Date(client.createdAt);
        if (Number.isNaN(d.getTime())) continue;
        const offset = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - first.getTime()) / 86400000);
        const snapped = offset - (offset % stepDays);
        const bucketStart = new Date(first);
        bucketStart.setDate(bucketStart.getDate() + snapped);
        const key = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}-${String(bucketStart.getDate()).padStart(2, "0")}`;
        const row = index.get(key);
        if (!row) continue;
        row.total += 1;
        switch (classifyStatus(client.status)) {
          case "won": row.won += 1; break;
          case "lost": row.lost += 1; break;
          case "progress": row.waiting += 1; break;
          default: row.other += 1;
        }
      }
      return buckets;
    })();

    return NextResponse.json({
      source: "postgres",
      period: { kind: period.kind, from: period.fromStr, to: period.toStr },
      from: period.from,
      to: period.to,
      rows,
      salespersonLeaderboard,
      firstSalespersonReport,
      secondSalespersonReport,
      timeline,
      totalClients: periodClients.length,
      totals,
      // Period-scoped breakdowns so every dashboard panel describes the same
      // window as the KPI cards above them.
      statusCounts,
      locationCounts,
      channelCounts,
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
