// Demo marketing spend — idempotent.
//
//   node --env-file=.env prisma/seed-marketing-demo.mjs
//
// Why this exists: the marketing page and the dashboard's spend / ROI / Avg-CPA
// cards all read MarketingMetric. With no rows they render as zeros, so there is
// nothing to judge a layout, a chart or the new demo data against.
//
// Three deliberate details:
//
// 1. The per-channel spends sum to EXACTLY 15,000 SAR. The page's headline stat
//    is a sum of these rows, so "roughly 15k" would print as some other number
//    and quietly contradict the figure this is meant to demonstrate. The total
//    is re-read from the database and asserted before the script exits.
//
// 2. Every row is keyed to a DISTINCT (startDate, endDate, channel) tuple,
//    because the model carries `@@unique([startDate, endDate, channel])`. Rows
//    are upserted on that key, so re-running refreshes the demo figures in
//    place instead of accumulating duplicates or throwing a constraint error.
//
// 3. Dates are 7-day windows ending today, so the rows fall inside the
//    "last 7 / 30 / 90 days" windows the dashboard offers by default. Older rows
//    would load fine and then show as zero on every default tab.
//
// To undo, without touching real data — the marker in `notes` is what makes
// this a safe one-liner:
//   delete from "MarketingMetric" where notes = 'demo';

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Marks every row this script owns, so the undo above cannot hit real data. */
const NOTE = "demo";
const TOTAL_SAR = 15000;

/** Channel -> its share of the budget. Arbitrary, but plausible per-channel. */
const BUDGET = {
  GOOGLE_ADS: 3400,
  INSTAGRAM: 2800,
  FACEBOOK: 2500,
  TIKTOK: 1900,
  CALLS: 1400,
  WHATSAPP: 1200,
  X: 1000,
  SALES: 800,
};

/**
 * Per-channel cost-per-mille and click-through rate.
 *
 * Engagement is expressed as a function of spend rather than as absolute
 * numbers: an absolute figure means nothing next to a given budget, and these
 * ratios are what make the page's Avg CPM and Avg CPC read as real figures.
 *
 * `ctr` is a fraction of IMPRESSIONS, and clicks are additionally capped below
 * impressions — a demo row where clicks exceeded impressions would render a CPM
 * of 0.00 and read as a bug rather than as data.
 */
const FUNNEL = {
  GOOGLE_ADS: { cpm: 18, ctr: 0.042 },
  INSTAGRAM: { cpm: 11, ctr: 0.031 },
  FACEBOOK: { cpm: 13, ctr: 0.026 },
  TIKTOK: { cpm: 7, ctr: 0.048 },
  CALLS: { cpm: 9, ctr: 0.055 },
  WHATSAPP: { cpm: 6, ctr: 0.061 },
  X: { cpm: 15, ctr: 0.019 },
  SALES: { cpm: 21, ctr: 0.038 },
};
/**
 * Weekly windows ending today, most recent first — 13 of them, i.e. three months.
 *
 * Was 4 windows (a month). The page's entry table pages at 25 rows, so 32 rows
 * filled barely more than one page and there was nothing to page through. At 8
 * channels x 13 weeks = 104 rows "view all data" actually means paging.
 *
 * Fixed 7-day steps rather than calendar Monday-to-Sunday: the weekday would
 * make the output differ run to run for no benefit.
 *
 * Widening this does NOT change the spend total: the budget is split evenly
 * across however many windows exist, so `TOTAL_SAR` still holds. Demo row ids are
 * `demo-mkt-<channel>-<index>` and indices 0-3 are unchanged, so re-running
 * updates the original month in place and appends the rest — no duplicates.
 */
const WEEKS = 13;
const windows = Array.from({ length: WEEKS }, (_, weeksAgo) => {
  const end = new Date();
  end.setDate(end.getDate() - weeksAgo * 7);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start, end };
});

/**
 * Deterministic pseudo-random in [min, max], so repeated runs produce identical
 * figures.
 *
 * FNV-1a over the seed rather than Math.random, which would re-roll the demo
 * data on every run and make "did my change take effect?" unanswerable.
 */
function spread(seed, min, max) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const n = ((h >>> 0) % 10000) / 10000;
  return min + n * (max - min);
}

/**
 * Runs a query, retrying a few times if the pooled connection drops.
 *
 * DATABASE_URL points at Neon's PGBouncer pooler. At 13 weeks x 8 channels this
 * script issues 100+ sequential statements, and the pooler will occasionally
 * close an idle server between two of them — Prisma reports that as P1017
 * "Server has closed the connection". It is a transport hiccup, not a data
 * problem: every statement here is an upsert keyed on
 * (startDate, endDate, channel), so replaying one is a no-op.
 */
async function retry(fn, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const transient = error?.code === "P1017" || /closed the connection|Connection reset|timed out/i.test(error?.message ?? "");
      if (!transient || attempt === 4) throw error;
      console.warn(`  ${label}: connection dropped (attempt ${attempt}/4), retrying…`);
      await new Promise((r) => setTimeout(r, attempt * 750));
    }
  }
}

async function main() {
  const entries = Object.entries(BUDGET);

  // Fail BEFORE touching the database if the budget no longer adds up, rather
  // than writing rows and then reporting a different total afterwards.
  const planned = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (planned !== TOTAL_SAR) {
    console.error(`BUDGET sums to ${planned}, expected ${TOTAL_SAR}. Fix BUDGET before running.`);
    process.exit(1);
  }
  // A channel with no ratios would divide by undefined and write NaN into a
  // Decimal column, which the database rejects with an opaque error.
  for (const [channel] of entries) {
    if (!FUNNEL[channel]) {
      console.error(`No FUNNEL ratios for ${channel}.`);
      process.exit(1);
    }
  }

  for (const [channel, budget] of entries) {
    const funnel = FUNNEL[channel];
    // The channel budget is split evenly across the windows, with the LAST
    // window carrying the remainder so the parts still sum to the whole. Floor
    // division alone would leave the difference unspent.
    const base = Math.floor(budget / windows.length);

    for (const [index, window] of windows.entries()) {
      const isLast = index === windows.length - 1;
      const spend = isLast ? budget - base * (windows.length - 1) : base;

      // +/-15% per row so the weekly bars are not identical, which would make
      // the monthly trend chart look like a rendering bug.
      const jitter = spread(`${channel}-${index}`, 85, 115) / 100;
      const impressions = Math.max(1000, Math.round((spend / funnel.cpm) * 1000 * jitter));
      const reach = Math.round(impressions * 0.62);
      const clicks = Math.min(impressions, Math.max(1, Math.round(impressions * funnel.ctr * jitter)));

      await retry(
        () =>
          prisma.marketingMetric.upsert({
        where: {
          startDate_endDate_channel: {
            startDate: window.start,
            endDate: window.end,
            channel,
          },
        },
        // Updated rather than skipped, so re-running refreshes the demo figures
        // in place instead of erroring on the unique constraint.
        update: {
          name: `Demo — ${channel}`,
          spend,
          reach,
          impressions,
          clicks,
          notes: NOTE,
        },
        create: {
          id: `demo-mkt-${channel.toLowerCase()}-${index}`,
          name: `Demo — ${channel}`,
          startDate: window.start,
          endDate: window.end,
          channel,
          spend,
          reach,
          impressions,
          clicks,
          notes: NOTE,
        },
      }),
        `${channel} w${index}`,
      );
    }
  }

  // Asserted against the DATABASE, not the in-memory plan: this is the number
  // the marketing page will actually print in its headline stat.
  const rows = await retry(
    () => prisma.marketingMetric.findMany({ where: { notes: NOTE } }),
    "verification read",
  );
  const stored = rows.reduce((sum, row) => sum + Number(row.spend), 0);
  if (Math.round(stored) !== TOTAL_SAR) {
    console.error(`Stored demo spend is ${stored}, expected ${TOTAL_SAR}.`);
    process.exit(1);
  }

  const covered = [...new Set(rows.map((row) => row.channel))].sort();
  console.log(`MarketingMetric: ${rows.length} demo row(s) across ${covered.length} channel(s)`);
  console.log(`Channels: ${covered.join(", ")}`);
  console.log(`Total demo spend: ${stored.toFixed(2)} SAR (target ${TOTAL_SAR})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());