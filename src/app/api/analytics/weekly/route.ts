import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listMetrics, readSetting, readSettingObject } from "@/lib/db";
import { businessDayKey } from "@/lib/business-days";
import { coerceMonthlyTargets } from "@/lib/targets";
import {
  BUCKETS_SETTING_KEY,
  channelLabels,
  classifyStatusWith,
  coerceStatusBuckets,
  parsePeriodKind,
  previousPeriod,
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

  /**
   * The comparison window for the KPI deltas — null for "all time".
   *
   * Resolved here, once, so the figure returned below and the window the cards
   * describe can never be derived from two different sets of bounds.
   */
  const previous = previousPeriod(period);

  /**
   * Optional status / channel / location narrowing, applied ON TOP of the period.
   *
   * These are the same three groups the clients page filters by, comma-separated
   * exactly as `filterValues()` parses them in /api/crm/clients, so a dashboard
   * filter and a clients filter mean the same thing. They intersect with the
   * period rather than replacing it: "Last 30 days + LOST" is LOST clients from
   * the last 30 days, which is what someone narrowing a chart expects.
   */
  const multi = (...keys: string[]): string[] | undefined => {
    for (const key of keys) {
      const list = (q.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
      if (list.length > 0) return list;
    }
    return undefined;
  };
  // Spread conditionally so an unfiltered group contributes no key at all —
  // `status: undefined` is not the same as omitting it once it reaches the
  // where-builder, so the omission is what keeps an unset filter out of the SQL.
  const groupFilter: { status?: string[]; channel?: string[]; location?: string[] } = {
    ...(multi("statuses", "status") ? { status: multi("statuses", "status") } : {}),
    ...(multi("channels", "channel") ? { channel: multi("channels", "channel") } : {}),
    ...(multi("locations", "location") ? { location: multi("locations", "location") } : {}),
  };

  try {
    const [metrics, periodClients, allClients, customStatuses, customLocations, customChannels, rawBuckets, rawTargets] = await Promise.all([
      listMetrics({ from: period.fromStr, to: period.toStr }),
      // Deliberately NOT includeArchived: an archived client is out of the book, so
      // counting it inflated every figure on this page — the KPI cards, the stage
      // panel, the funnel, the location and channel bars, the timeline and the
      // salesperson reports all derive from this one array. This is the only
      // change needed to exclude them from all of them at once.
      listClients({
        ...groupFilter,
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
      // The admin's status -> bucket assignments from the Options page. Empty on
      // an untouched workspace, and then `classifyStatusWith` falls through to the
      // built-in pipeline, so every figure below is unchanged.
      readSettingObject(BUCKETS_SETTING_KEY),
      readSettingObject("targets"),
    ]);

    /* Coerced once and threaded through every bucketing pass below — the KPI
       cards, the workload, the salesperson reports and the timeline. Reading it
       in each of those instead would let one of them quietly keep using the
       built-in pipeline, which is exactly the "the cards say one thing and the
       funnel says another" bug this is meant to fix.

       Named `statusBuckets`, not `buckets`: the timeline builder further down
       already has a local `buckets` array holding its series, and shadowing it
       would silently pass an array where a map is expected. */
    const statusBuckets = coerceStatusBuckets(rawBuckets);
    const isProgress = (status: string) => classifyStatusWith(status, statusBuckets) === "progress";

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
        switch (classifyStatusWith(client.status, statusBuckets)) {
          case "won": counts.won += 1; break;
          case "lost": counts.lost += 1; break;
          case "progress": counts.waiting += 1; break;
          default: counts.other += 1;
        }
      }
      return counts;
    };

    const daysToWin = (client: (typeof periodClients)[number]): number | null => {
      if (classifyStatusWith(client.status, statusBuckets) !== "won") return null;
      const created = businessDayKey(client.createdAt);
      const updated = businessDayKey(client.lastUpdateDate);
      if (!created || !updated || updated <= created) return null;
      return (Date.parse(`${updated}T00:00:00Z`) - Date.parse(`${created}T00:00:00Z`)) / 86400000;
    };
    const summarizeDays = (values: number[]) => {
      if (values.length === 0) return { count: 0, averageDays: null, medianDays: null };
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
      const round = (value: number) => Math.round(value * 10) / 10;
      return {
        count: values.length,
        averageDays: round(values.reduce((sum, value) => sum + value, 0) / values.length),
        medianDays: round(median),
      };
    };
    const velocityFor = (
      list: typeof periodClients,
      pick: (client: (typeof periodClients)[number]) => string,
    ) => {
      const grouped = new Map<string, number[]>();
      for (const client of list) {
        const days = daysToWin(client);
        const key = pick(client).trim();
        if (days === null || !key) continue;
        const values = grouped.get(key) ?? [];
        values.push(days);
        grouped.set(key, values);
      }
      return Object.fromEntries([...grouped.entries()].map(([key, values]) => [key, summarizeDays(values)]));
    };

    const rows = [...channelSet].map((channel) => {
      const metric = metrics.find((m) => m.channel === channel);
      const channelClients = periodClients.filter((c) => c.acquisitionChannel === channel);
      // Registry-driven, so a new pipeline stage is picked up automatically
      // instead of silently landing in "other".
      const { won, lost, waiting, other } = bucket(channelClients);
      const channelVelocity = summarizeDays(
        channelClients.map(daysToWin).filter((days): days is number => days !== null),
      );
      const spend = Number(metric?.spend ?? 0);
      const platform = channelLabels[channel] ?? channel;

      /* ── ROI drill-down detail (ADDITIVE — existing fields above are untouched) ──
         `spend`/`reach` keep their original "first campaign for this channel"
         reading so no existing consumer's numbers move; the new figures below
         deliberately aggregate EVERY campaign in the window, because a channel
         with three campaigns must not report the clicks of one. */
      const campaigns = metrics.filter((m) => m.channel === channel);
      const impressions = campaigns.reduce((s, m) => s + Number(m.impressions ?? 0), 0);
      const clicks = campaigns.reduce((s, m) => s + Number(m.clicks ?? 0), 0);
      const costPerClick = clicks > 0 ? spend / clicks : 0;

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
        medianDaysToWin: channelVelocity.medianDays,
        /* Conversion = won ÷ this channel's clients in the period — the same
           numerator/denominator the funnel uses, so the ROI table and the funnel
           can never disagree about the same window. */
        conversionRate: channelClients.length > 0 ? won / channelClients.length : 0,
        /* Explicit status split for drill-down tooltips, mirroring `bucket`. */
        statusBreakdown: { won, lost, waiting, other },
        campaignCount: campaigns.length,
        impressions,
        clicks,
        /* CTR as a fraction of impressions (0–1), matching how the marketing
           page already derives it from raw counters. */
        ctr: impressions > 0 ? clicks / impressions : 0,
        costPerClick,
      };
    });

    // Campaign names inside this window, for the dashboard's period summary.
    const campaignNames = [...new Set(metrics.map((m) => m.name).filter((n): n is string => Boolean(n)))];

    // Period totals for the KPI cards. The client used to recompute these from
    // the full client list, which silently reverted them to all-time numbers.
    // `other` is what makes won + lost + waiting reconcile to `total`.
    const totals = { total: periodClients.length, ...bucket(periodClients) };
    /* The comparison figures for the KPI deltas.
       Same client query, same filters, same bucket assignments — only the date
       bounds differ. Run through the identical `bucket` helper rather than a
       second implementation, so a change to how statuses are classified cannot
       move one side of the comparison and not the other. Spend/reach come from
       the metrics list for that window.

       `total` is included because the "Client overview" card is delta'd too.
       Null throughout for "all time": there is no previous window to compare
       with, and the client suppresses the arrows rather than inventing one. */
    let previousTotals: {
      from: string; to: string;
      totals: { total: number; won: number; lost: number; waiting: number; other: number };
      spend: number; reach: number;
    } | null = null;
    if (previous) {
      const [prevClients, prevMetrics] = await Promise.all([
        listClients({
          ...groupFilter,
          assignee: assigneeScope(sessionUser),
          createdFrom: previous.fromStr,
          createdTo: previous.toStr,
        }),
        listMetrics({ from: previous.fromStr, to: previous.toStr }),
      ]);
      previousTotals = {
        from: previous.fromStr,
        to: previous.toStr,
        totals: { total: prevClients.length, ...bucket(prevClients) },
        spend: prevMetrics.reduce((s, m) => s + Number(m.spend ?? 0), 0),
        reach: prevMetrics.reduce((s, m) => s + Number(m.reach ?? 0), 0),
      };
    }

    const workload = new Map<string, number>();
    periodClients
      .filter((c) => isProgress(c.status))
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
      const map = new Map<string, { won: number; lost: number; waiting: number; other: number; total: number; daysToWin: number[] }>();
      for (const client of periodClients) {
        const key = pick(client);
        if (!key) continue;
        const row = map.get(key) ?? { won: 0, lost: 0, waiting: 0, other: 0, total: 0, daysToWin: [] };
        row.total += 1;
        switch (classifyStatusWith(client.status, statusBuckets)) {
          case "won": {
            row.won += 1;
            const days = daysToWin(client);
            if (days !== null) row.daysToWin.push(days);
            break;
          }
          case "lost": row.lost += 1; break;
          case "progress": row.waiting += 1; break;
          default: row.other += 1;
        }
        map.set(key, row);
      }
      // Busiest book first, so the people carrying the most clients are on top.
      return [...map.entries()]
        .map(([name, values]) => {
          const { daysToWin: samples, ...outcomes } = values;
          return {
            name,
            ...outcomes,
            medianDaysToWin: summarizeDays(samples).medianDays,
            winRate: values.won + values.lost > 0
              ? Math.round((values.won / (values.won + values.lost)) * 100)
              : null,
          };
        })
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
    const locationRows = Object.entries(locationCounts).map(([location, total]) => {
      const locationClients = periodClients.filter((client) => client.location === location);
      const { won, lost, waiting, other } = bucket(locationClients);
      return {
        location,
        total,
        won,
        lost,
        waiting,
        other,
        winRate: won + lost > 0 ? won / (won + lost) : null,
        share: periodClients.length > 0 ? total / periodClients.length : 0,
      };
    }).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location, "ar"));
    const velocity = {
      overall: summarizeDays(periodClients.map(daysToWin).filter((days): days is number => days !== null)),
      byOwner: velocityFor(periodClients, (client) => client.firstContactPerson),
      byChannel: velocityFor(periodClients, (client) => client.acquisitionChannel),
    };

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
     * `classifyStatusWith` the KPI cards use, so the chart and the cards can never
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
        switch (classifyStatusWith(client.status, statusBuckets)) {
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
      /* The map that produced `totals`, so the client rebuilds its funnel and
         stage panel from the SAME assignments rather than re-deriving them from
         the built-in pipeline. Without this the cards would honour the admin's
         choice while the funnel beside them silently did not. */
      statusBuckets,
      /* Present only when a comparison window exists (i.e. not "all time"). The
         client reads it to decide whether to draw a delta on each KPI card. */
      previous: previousTotals,
      // Period-scoped breakdowns so every dashboard panel describes the same
      // window as the KPI cards above them.
      statusCounts,
      locationCounts,
      locationRows,
      channelCounts,
      velocity,
      targets: coerceMonthlyTargets(rawTargets),
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
