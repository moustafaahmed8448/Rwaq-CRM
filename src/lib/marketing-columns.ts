/**
 * Marketing metrics table column registry — the counterpart of client-columns.ts.
 *
 * The entries table renders seven data columns in a fixed order (plus the select
 * and actions gutters), and this list is the single source of truth for that
 * order, for the default widths, and for what may be resized. The page builds its
 * `grid-template-columns` from `gridTemplate()` over these values rather than from
 * a hard-coded CSS template, so a drag changes one track and every row follows.
 *
 * The default widths are the `minmax()` minimums marketing.css used before, so an
 * un-customised table looks as it did.
 *
 * Deliberately SEPARATE from CLIENT_COLUMNS: the two tables share no column, and
 * sharing one registry would mean a clients-layout change silently resizing the
 * marketing table (and vice versa). They also persist to different columns on
 * AppUser — `clientColumns` vs `marketingColumns`.
 *
 * The generic machinery lives in column-registry.ts; this file only binds it to
 * the marketing vocabulary.
 */
import {
  resolveColumns as resolveColumnsFor,
  sanitizePrefs as sanitizePrefsFor,
  type ColumnPrefs,
  type GridColumn,
  type Resolved,
} from "@/lib/column-registry";

export type MarketingColumnKey =
  | "select"
  | "channel"
  | "campaign"
  | "period"
  | "spend"
  | "reach"
  | "notes"
  | "actions";

export type MarketingColumn = GridColumn<MarketingColumnKey>;

/** A marketing column with a concrete width and visibility. */
export type ResolvedMarketingColumn = Resolved<MarketingColumn>;

export type { ColumnPrefs };
export { gridTemplate } from "@/lib/column-registry";

/** Merges a sparse saved layout over the marketing column defaults. */
export const resolveMarketingColumns = (prefs?: ColumnPrefs | null): ResolvedMarketingColumn[] =>
  resolveColumnsFor(MARKETING_COLUMNS, prefs ?? null);

/** Clamps a saved payload against the marketing column bounds. */
export const sanitizeMarketingPrefs = (input: unknown): ColumnPrefs =>
  sanitizePrefsFor(MARKETING_COLUMNS, input);

/**
 * `select` and `actions` are fixed-width gutters — a 30px checkbox column and the
 * two icon buttons — so they are locked exactly as the clients table locks its
 * own. Everything else is resizable between the bounds below.
 */
export const MARKETING_COLUMNS: readonly MarketingColumn[] = [
  { key: "select",   labelKey: "",                 w: 30,  min: 30,  max: 30,  locked: true  },
  { key: "channel",  labelKey: "dash.thChannel",   w: 120, min: 110, max: 240, locked: false },
  { key: "campaign", labelKey: "mkt.campaignName", w: 170, min: 150, max: 460, locked: false },
  { key: "period",   labelKey: "dash.thPeriod",    w: 150, min: 130, max: 320, locked: false },
  { key: "spend",    labelKey: "dash.thSpend",     w: 100, min: 90,  max: 220, locked: false },
  { key: "reach",    labelKey: "dash.thReach",     w: 85,  min: 70,  max: 200, locked: false },
  { key: "notes",    labelKey: "dash.thNotes",     w: 140, min: 120, max: 460, locked: false },
  { key: "actions",  labelKey: "",                 w: 62,  min: 62,  max: 62,  locked: true  },
];
