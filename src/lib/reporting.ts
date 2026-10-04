// Channel / status helpers.
//
// These are plain strings rather than Prisma enums so the app can store
// user-defined channels (e.g. FORSA) and custom statuses (e.g. NEW).

import { addBusinessDays, businessDayKey, startOfBusinessDay, startOfNextBusinessDay } from "./business-days";
import { dateLocale } from "./format";

export const channelLabels: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  X: "X",
  TIKTOK: "TikTok",
  GOOGLE_ADS: "Google Ads",
  WHATSAPP: "WhatsApp",
  CALLS: "Calls",
  SALES: "Sales",
};

export const channelValues = Object.keys(channelLabels);

/**
 * Built-in channels to drop from a filter list because a custom channel already
 * stands in for them.
 *
 * The workspace's "Sales" channel is stored as the custom Arabic value
 * `المبيعات`, which this label map renders as "Sales" too. Listing the built-in
 * `SALES` next to it produced TWO "Sales" rows for one real channel, and picking
 * the built-in one returned nothing, because no client stores that value.
 *
 * A built-in is dropped only when BOTH hold:
 *   - no client actually stores it, and
 *   - some other channel in the list renders to the same label.
 *
 * The second condition is what keeps this safe. Dropping every unused built-in
 * would empty the dropdowns on a fresh workspace, and dropping by label alone
 * would collapse two genuinely different channels that merely happen to share a
 * display name. Neither is safe, so neither is done.
 *
 * `render` is the caller's label function (channelLabel), so this agrees with
 * whatever the user actually sees in the list.
 */
export function redundantBuiltinChannels(
  candidates: Iterable<string>,
  usedChannels: Iterable<string>,
  render: (value: string) => string,
): string[] {
  const used = new Set<string>();
  for (const c of usedChannels) if (c) used.add(String(c).toUpperCase());
  const list = [...candidates];
  const labelsInUse = new Set(list.filter((v) => used.has(String(v).toUpperCase())).map(render));
  return list.filter((v) => {
    if (used.has(String(v).toUpperCase())) return false; // real data depends on it
    return labelsInUse.has(render(v)); // another row already shows this label
  });
}

/**
 * Built-in locations. This list used to be duplicated in src/app/page.tsx
 * (CUSTOM_LOCATIONS) and src/app/api/locations/route.ts (DEFAULT_LOCATIONS), so
 * the two could silently disagree about which values are built-ins — and
 * therefore which are deletable.
 *
 * `key` is the stored/English value and is never translated on write; the label
 * is only for display, so switching language never rewrites client data.
 */
export interface LocationEntry { key: string; labelKey: string }

export const BUILTIN_LOCATIONS: readonly LocationEntry[] = [
  { key: "Riyadh", labelKey: "loc.riyadh" },
  { key: "Jeddah", labelKey: "loc.jeddah" },
  { key: "Makkah", labelKey: "loc.makkah" },
  { key: "Madinah", labelKey: "loc.madinah" },
  { key: "Dammam", labelKey: "loc.dammam" },
  { key: "Khobar", labelKey: "loc.khobar" },
  { key: "Dhahran", labelKey: "loc.dhahran" },
  { key: "Taif", labelKey: "loc.taif" },
  { key: "Abha", labelKey: "loc.abha" },
  { key: "Tabuk", labelKey: "loc.tabuk" },
] as const;

export const BUILTIN_LOCATION_KEYS = BUILTIN_LOCATIONS.map((l) => l.key);

const LOCATION_KEYS: Record<string, string> = Object.fromEntries(
  BUILTIN_LOCATIONS.map((l) => [l.key, l.labelKey]),
);

/**
 * Localized display label for a location.
 *
 * Only the built-in cities are translated. User-defined locations are customer
 * data and are returned untouched, so nothing the user typed is ever altered.
 */
export function locationLabel(t: TranslateFn, location: string): string {
  const key = LOCATION_KEYS[location];
  return key ? translated(t, key, location) : location;
}

/** True when the location is one of the built-in, non-deletable cities. */
export function isBuiltinLocation(location: string): boolean {
  return BUILTIN_LOCATION_KEYS.includes(location);
}

/* ── Client pipeline ─────────────────────────────────────────────────────────
   Single source of truth for the built-in statuses. This used to be duplicated
   as a bare ["WAITING","WON","LOST"] array in four files, so adding a status in
   one place silently left the other three disagreeing. Everything now imports
   from here.

   The pipeline is ordered: `order` drives the funnel and the status panel, so a
   stage can never drift out of sequence. `outcome` marks the two terminal
   stages, which is what the win rate, ROI and CPA calculations key off —
   everything that is neither WON nor LOST is still "in progress". */

export type StageOutcome = "progress" | "won" | "lost";

export interface PipelineStage {
  /** Stored Client.status value. Never renamed without a migration. */
  value: string;
  /** Dictionary key for the localized label. */
  labelKey: string;
  /** English fallback used when the dictionary entry is missing. */
  fallback: string;
  /** Position in the funnel, ascending. */
  order: number;
  outcome: StageOutcome;
  /** Accent colour, used by the status panel, funnel and pills. */
  color: string;
}

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { value: "NO_RESPONSE", labelKey: "stage.noResponse", fallback: "Non-responsive", order: 1, outcome: "progress", color: "#94a3b8" },
  { value: "CONTACTED", labelKey: "stage.contacted", fallback: "Contacted", order: 2, outcome: "progress", color: "#0891b2" },
  { value: "QUALIFIED", labelKey: "stage.qualified", fallback: "Qualified", order: 3, outcome: "progress", color: "#4f46e5" },
  { value: "QUOTES", labelKey: "stage.quotes", fallback: "Sales to contact & quote", order: 4, outcome: "progress", color: "#f59e0b" },
  { value: "WON", labelKey: "stage.won", fallback: "Contracted", order: 5, outcome: "won", color: "#22c55e" },
  { value: "LOST", labelKey: "stage.lost", fallback: "Final loss", order: 6, outcome: "lost", color: "#ef4444" },
] as const;

export const PREDEFINED_STATUSES: string[] = PIPELINE_STAGES.map((s) => s.value);

/** Ordered stage list, excluding the two terminal ones — the active pipeline. */
export const PROGRESS_STAGES: readonly PipelineStage[] =
  PIPELINE_STAGES.filter((s) => s.outcome === "progress");

const STAGE_BY_VALUE = new Map(PIPELINE_STAGES.map((s) => [s.value, s]));

/**
 * Maps a stored status onto the current pipeline.
 *
 * Rows written before the 6-stage pipeline used WAITING. Left alone, that value
 * matches no stage, so the client silently vanishes from every count, the "in
 * progress" total reads 0, and the pill has no colour. Applied on the read path
 * (toClientRow) so the UI is correct immediately — the SQL migration then only
 * has to clean up rows that are never re-written.
 */
export function normalizeStatus(status: string): string {
  const key = String(status ?? "").trim().toUpperCase().replace(/[ /-]+/g, "_");
  if (key === "WAITING") return "NO_RESPONSE";
  return status;
}

/** Looks up a stage; undefined for user-defined custom statuses. */
export function pipelineStage(status: string): PipelineStage | undefined {
  return STAGE_BY_VALUE.get(normalizeStatus(status));
}

/**
 * How a client counts towards the outcome totals.
 *
 * `other` is the bucket that was silently missing. `isWon`/`isLost`/
 * `isInProgress` each test the BUILT-IN pipeline, so a user-defined status
 * returned false for all three and simply disappeared from the KPI cards, the
 * ROI table and the salesperson rows — the three figures summed to less than
 * the client count with nothing to indicate why. In this workspace that was 94
 * of 339 clients (79 «غير مناسب» + 15 «مطلوب تواصل»), created as customs by the
 * sheet import.
 *
 * They are reported, never reassigned: silently filing a custom status into
 * "lost" or "in progress" would invent a judgement the user never made.
 */
export type StatusOutcome = "won" | "lost" | "progress" | "other";

/** The single definition of the four buckets; everything else derives from it. */
export function classifyStatus(status: string): StatusOutcome {
  const outcome = pipelineStage(status)?.outcome;
  return outcome === "won" || outcome === "lost" || outcome === "progress" ? outcome : "other";
}

/**
 * Admin-set bucket assignments: stored status value -> outcome.
 *
 * An admin decides this on the Options page, which is what lets "In progress" and
 * "Other" be driven by the workspace's own statuses rather than by the built-in
 * pipeline alone. A status the admin has NOT assigned falls back to
 * `classifyStatus`, so an untouched workspace behaves exactly as before.
 */
export type StatusBuckets = Record<string, StatusOutcome>;

/**
 * Setting key holding those assignments.
 *
 * Declared here rather than in /api/options so the analytics route can read the
 * same row without importing a route module: this module is deliberately free of
 * `next/server`, which is what lets both the server routes and the client
 * bundles import it.
 */
export const BUCKETS_SETTING_KEY = "statusBuckets";

/** The four buckets, in the order the Options page offers them. */
export const STATUS_OUTCOMES: readonly StatusOutcome[] = ["won", "lost", "progress", "other"];

/**
 * `classifyStatus` with the admin's overrides applied.
 *
 * Kept as a SEPARATE function rather than an optional argument on
 * `classifyStatus` on purpose. `classifyStatus` is called on every read path —
 * the API, the export, the kanban, the funnel — and threading an optional map
 * through all of them invites a call site that silently forgets it, which would
 * show one screen's numbers disagreeing with another's. Making the override an
 * explicit, separately-named function means the call sites that must honour the
 * admin's choice are exactly the ones that call this one.
 */
export function classifyStatusWith(status: string, buckets?: StatusBuckets | null): StatusOutcome {
  const assigned = buckets?.[String(status ?? "").trim()];
  // Guarded by the same membership test as the built-in branch below, so a
  // hand-edited or stale setting cannot introduce a fifth bucket that every
  // `switch` in the app would silently drop into `default`.
  return assigned && STATUS_OUTCOMES.includes(assigned) ? assigned : classifyStatus(status);
}

/**
 * Coerces a stored/hand-edited bucket map into a valid one.
 *
 * The row is user-editable through the API, so anything can end up in it. Entries
 * that are not a known bucket are dropped here rather than at every call site,
 * which is the same defence `coerceColors` applies to the colour map.
 */
export function coerceStatusBuckets(raw: unknown): StatusBuckets {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: StatusBuckets = {};
  for (const [status, outcome] of Object.entries(raw as Record<string, unknown>)) {
    if (status && typeof outcome === "string" && STATUS_OUTCOMES.includes(outcome as StatusOutcome)) {
      out[status] = outcome as StatusOutcome;
    }
  }
  return out;
}

/** True when the status is a terminal outcome (contracted / lost). */
export function isWon(status: string): boolean {
  return classifyStatus(status) === "won";
}
export function isLost(status: string): boolean {
  return classifyStatus(status) === "lost";
}
/** True while the client is still moving through the pipeline. */
export function isInProgress(status: string): boolean {
  return classifyStatus(status) === "progress";
}

/** English stage name, for server-side output such as the Excel export. */
export function stageFallback(status: string): string {
  return STAGE_BY_VALUE.get(normalizeStatus(status))?.fallback ?? status;
}

/**
 * Accents for user-defined statuses, cycled by a hash of the value so the same
 * custom status keeps the same colour in the status panel, its pill and the
 * kanban dot. A flat grey was unusable: the first pipeline stage is already
 * grey, so a custom status and "Non-responsive" looked identical.
 */
const CUSTOM_STATUS_COLORS = ["#7c3aed", "#db2777", "#0d9488", "#ea580c", "#2563eb", "#65a30d"] as const;

/**
 * Stable palette colour for any value with no built-in colour of its own.
 *
 * Cycled by a hash of the value, so the same custom status — or location — keeps
 * the same colour everywhere it appears. A flat grey was unusable: the first
 * pipeline stage is already grey, so a custom status and "Non-responsive" looked
 * identical.
 *
 * Exported because `optionColor` in src/lib/ref-options.ts needs the same
 * fallback for channels and locations, and two hash implementations would let
 * one value pick a different colour depending on which screen rendered it.
 */
export function hashedColor(key: string): string {
  const value = String(key ?? "");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return CUSTOM_STATUS_COLORS[hash % CUSTOM_STATUS_COLORS.length];
}

/** Accent colour for a status; custom statuses get a stable palette colour. */
export function statusColor(status: string): string {
  const stage = STAGE_BY_VALUE.get(status);
  if (stage) return stage.color;
  return hashedColor(status);
}

/** Dictionary keys for the built-in channels / statuses (see src/lib/i18n.tsx). */
const CHANNEL_KEYS: Record<string, string> = {
  FACEBOOK: "ch.facebook",
  INSTAGRAM: "ch.instagram",
  X: "ch.x",
  TIKTOK: "ch.tiktok",
  GOOGLE_ADS: "ch.googleAds",
  WHATSAPP: "ch.whatsapp",
  CALLS: "ch.calls",
  SALES: "ch.sales",
};
const STATUS_KEYS: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.value, s.labelKey]),
);
/** App roles stored on AppUser.role (never renamed, only displayed translated). */
const ROLE_KEYS: Record<string, string> = {
  Admin: "role.admin",
  Sales: "role.sales",
  CRM: "role.crm",
  Visitor: "role.visitor",
};

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** Returns the translated string, or `fallback` when the key is not defined. */
function translated(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

/**
 * Localized display label for a channel.
 * Built-in channels (FACEBOOK, …) are translated; user-defined channels keep
 * their stored value so no data is ever altered.
 */
export function channelLabel(t: TranslateFn, channel: string): string {
  const key = CHANNEL_KEYS[channel];
  const fallback = channelLabels[channel];
  return key && fallback ? translated(t, key, fallback) : channel;
}

/** Localized display label for a status; custom statuses stay as stored. */
export function statusLabel(t: TranslateFn, status: string): string {
  const key = STATUS_KEYS[status];
  const stage = pipelineStage(status);
  if (key && stage) return translated(t, key, stage.fallback);
  return status;
}

/** Localized display label for a user role (Admin / Sales / CRM). */
export function roleLabel(t: TranslateFn, role: string): string {
  const key = ROLE_KEYS[role];
  return key ? translated(t, key, role) : role;
}

/**
 * Client column keys → dictionary key. The PascalCase entries are the legacy
 * English labels that older activity rows stored in `field`, so both forms
 * resolve to the same translation.
 */
const FIELD_KEYS: Record<string, string> = {
  name: "client.field.name",
  phoneNumber: "client.field.phone",
  status: "client.field.status",
  acquisitionChannel: "client.field.channel",
  project: "client.field.project",
  location: "client.field.location",
  operationToTake: "client.field.operation",
  firstContactPerson: "client.field.firstContact",
  secondContactPerson: "client.field.secondContact",
  notes: "client.field.notes",
  /* Follow-up was missing here, so the history printed the raw column name —
     `nextFollowUpAt` — in the timeline instead of a translated label. */
  nextFollowUpAt: "client.field.followUp",
  Name: "client.field.name",
  Phone: "client.field.phone",
  Status: "client.field.status",
  Channel: "client.field.channel",
  Project: "client.field.project",
  Location: "client.field.location",
  Operation: "client.field.operation",
  "1st Contact": "client.field.firstContact",
  "2nd Contact": "client.field.secondContact",
  Notes: "client.field.notes",
};

/**
 * Normalizes a (possibly legacy) activity `field` value to the canonical
 * Client column key, so value labels are resolved the same way for new rows
 * ("acquisitionChannel") and old ones ("Channel").
 */
const CANONICAL_FIELDS = new Set([
  "name", "phoneNumber", "status", "acquisitionChannel", "project",
  "location", "operationToTake", "firstContactPerson", "secondContactPerson", "notes",
  "nextFollowUpAt",
]);

function fieldKey(field: string): string {
  return CANONICAL_FIELDS.has(field) ? field : field.toLowerCase();
}

/** Localized display label for an activity-log field name. */
export function activityFieldLabel(t: TranslateFn, field: string): string {
  const key = FIELD_KEYS[field];
  return key ? translated(t, key, field) : field;
}

/**
 * Localized value for an activity change. Status and channel values are
 * translated; dates are rendered as dates; every other value is user data and is
 * returned untouched.
 */
export function activityValueLabel(t: TranslateFn, field: string, value: string | undefined, lang = "en"): string {
  if (value === undefined) return "";
  if (value.trim() === "") return t("form.unassigned");
  const key = fieldKey(field);
  if (key === "status") return statusLabel(t, value);
  if (key === "acquisitionChannel") return channelLabel(t, value);
  /* A follow-up is stored as a timestamp, so the raw value is an ISO string.
     Rendering it verbatim put `2026-09-24T00:30:00.000Z` in the timeline — the
     column's storage format, in a place meant for a person to read.
     `lang` is optional because only date-bearing fields need it; the callers
     that show dates pass the viewer's, and the rest fall back to English. */
  if (key === "nextFollowUpAt") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(dateLocale(lang));
  }
  return value;
}

/** Structural shape shared with ActivityEntry (kept loose to avoid a cycle). */
export interface ActivityLike {
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  clientName?: string;
  summary?: string;
}

/** Localized one-line description of an activity-log entry. */
export function describeActivity(t: TranslateFn, entry: ActivityLike): string {
  const name = entry.clientName ?? "";
  switch (entry.action) {
    case "CREATED":
      return t("act.created");
    case "DELETED":
      return t("act.deleted");
    case "ARCHIVED":
      return t("act.archived", { name: name || t("act.client") });
    case "RESTORED":
      return t("act.restored", { name: name || t("act.client") });
    case "STATUS_CHANGE":
      return t("act.statusChanged", {
        old: activityValueLabel(t, "status", entry.oldValue ?? ""),
        new: activityValueLabel(t, "status", entry.newValue ?? ""),
      });
    case "NOTE_ADD":
    case "NOTE_EDIT":
      return t("act.notesUpdated");
    case "FIELD_EDIT":
      return t("act.fieldUpdated", { field: activityFieldLabel(t, entry.field ?? "") });
    default:
      // Legacy rows written before localization keep their stored sentence.
      return entry.summary ?? t("act.unknown");
  }
}

/**
 * Notification types → dictionary key. The contact role is encoded in the
 * type so the message can be localized at render time without a migration.
 */
const NOTIFICATION_KEYS: Record<string, string> = {
  ASSIGNED: "notif.assigned",
  "ASSIGNED:1st": "notif.assignedFirst",
  "ASSIGNED:2nd": "notif.assignedSecond",
};

/** Localized notification text; unknown/legacy types keep the stored message. */
export function notificationMessage(
  t: TranslateFn,
  n: { type?: string | null; clientName?: string | null; message: string },
): string {
  const key = n.type ? NOTIFICATION_KEYS[n.type] : undefined;
  if (!key || !n.clientName) return n.message;
  return t(key, { name: n.clientName });
}

export function parseChannel(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const key = value.trim().toUpperCase().replace(/[ /-]+/g, "_");
  if (!key || key === "ALL") return undefined;
  const aliases: Record<string, string> = {
    FACEBOOK: "FACEBOOK",
    INSTAGRAM: "INSTAGRAM",
    META: "FACEBOOK",
    TWITTER: "X",
    X: "X",
    TIKTOK: "TIKTOK",
    GOOGLE: "GOOGLE_ADS",
    GOOGLE_ADS: "GOOGLE_ADS",
    WHATSAPP: "WHATSAPP",
    CALL: "CALLS",
    CALLS: "CALLS",
    SALES: "SALES",
  };
  // Known aliases normalize to their canonical value; anything else is treated
  // as a custom channel and kept as-is.
  return aliases[key] ?? (key.length >= 2 ? key : undefined);
}

export function parseStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const key = value.trim().toUpperCase().replace(/[ /-]+/g, "_");
  if (!key || key === "ALL") return undefined;
  // Rows written before the 6-stage pipeline used WAITING. Treat it as the
  // first stage so legacy data still reads correctly even if the migration
  // has not been applied yet.
  if (key === "WAITING") return "NO_RESPONSE";
  return key;
}

export const startOfWeek = (date = new Date()) => {
  /* The weekday is read from the BUSINESS day's key, not `getDay()`. On a UTC
     server late in the evening, `getDay()` names tomorrow while the user's
     calendar still says today, which would start the week a day out. */
  const key = businessDayKey(date);
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
  return startOfBusinessDay(addBusinessDays(key, weekday === 0 ? -6 : 1 - weekday));
};

export const endOfWeek = (date = new Date()) =>
  startOfBusinessDay(addBusinessDays(businessDayKey(startOfWeek(date)), 7));

export const startOfMonth = (date = new Date()) => {
  const key = businessDayKey(date);
  return startOfBusinessDay(addBusinessDays(key, -(Number(key.slice(8, 10)) - 1)));
};

export const endOfMonth = (date = new Date()) => {
  const key = businessDayKey(date);
  return startOfBusinessDay(addBusinessDays(key, Number(key.slice(8, 10))));
};

export type PeriodKind =
  | "today"
  | "week"
  | "last3"
  | "last7"
  | "last14"
  | "last30"
  | "last90"
  | "month"
  | "year"
  | "all"
  | "custom";

export interface ResolvedPeriod {
  kind: PeriodKind;
  from: Date;
  to: Date;
  /** YYYY-MM-DD bounds, ready to hand to the query layer. */
  fromStr: string;
  toStr: string;
}

/**
 * Start of the "all time" window.
 *
 * A fixed epoch rather than a wide-open range, because the query layer takes
 * concrete bounds. 1970-01-01 predates any client this app can hold, so every
 * row falls inside it.
 */
const EPOCH = startOfBusinessDay("1970-01-01");

/** YYYY-MM-DD in BUSINESS_TZ. Alias of businessDayKey, kept local for brevity. */
const dayKey = businessDayKey;

/**
 * Resolves the dashboard reporting window.
 *
 * The period used to be hardcoded to startOfWeek()/endOfWeek() with no way to
 * change it, and the client counts were never filtered by date at all — so the
 * spend figures described this week while won/lost described all of time. Every
 * consumer now derives both from the same ResolvedPeriod, which is what makes
 * the ratios (CPA, win rate) meaningful.
 *
 * `custom` falls back to the current week when the bounds are unusable, so a
 * malformed query string can never produce an inverted or empty range.
 */
export function resolvePeriod(kind: PeriodKind, from?: string, to?: string, now = new Date()): ResolvedPeriod {
  if (kind === "custom" && from && to) {
    /* A user-supplied end date is INCLUSIVE, so the upper bound becomes the start
       of the next day. Both bounds are business-day midnights, not this host's:
       `new Date("2026-09-05")` parses as UTC midnight, three hours into the
       previous Riyadh day. */
    if (!Number.isNaN(new Date(from).getTime()) && !Number.isNaN(new Date(to).getTime()) && from <= to) {
      const a = startOfBusinessDay(from);
      const inclusiveEnd = startOfNextBusinessDay(to);
      return { kind, from: a, to: inclusiveEnd, fromStr: dayKey(a), toStr: dayKey(inclusiveEnd) };
    }
  }
  // "all" spans epoch → tomorrow. Tomorrow rather than today because the upper
  // bound is EXCLUSIVE everywhere it is consumed (`createdAt: { lt }` in
  // clientWhere), so `today` would drop clients registered earlier the same day.
  if (kind === "all") {
    const to = startOfNextBusinessDay(dayKey(now));
    const from = new Date(EPOCH);
    return { kind, from, to, fromStr: dayKey(from), toStr: dayKey(to) };
  }

  // Rolling windows, resolved before the calendar ones so a new tab only needs a
  // single entry here.
  const rolling: Partial<Record<PeriodKind, number>> = {
    today: 1,
    last3: 3,
    last7: 7,
    last14: 14,
    last30: 30,
    last90: 90,
  };
  const days = rolling[kind];
  if (days !== undefined) {
    const window = rollingWindow(days, now);
    return { kind, from: window.from, to: window.to, fromStr: window.fromStr, toStr: window.toStr };
  }

  if (kind === "year") {
    const year = Number(dayKey(now).slice(0, 4));
    const from = startOfBusinessDay(`${year}-01-01`);
    const to = startOfBusinessDay(`${year + 1}-01-01`);
    return { kind, from, to, fromStr: dayKey(from), toStr: dayKey(to) };
  }

  // "week" and "month" fall through to here, the two calendar-bounded periods.
  const fromDate = kind === "month" ? startOfMonth(now) : startOfWeek(now);
  const toDate = kind === "month" ? endOfMonth(now) : endOfWeek(now);
  return { kind, from: fromDate, to: toDate, fromStr: dayKey(fromDate), toStr: dayKey(toDate) };
}

/**
 * The window of identical length immediately BEFORE `period`.
 *
 * This is what the dashboard's KPI deltas compare against. "Identical length,
 * immediately before" is chosen over a named prior period because it is the only
 * rule that stays true for every tab: "last 30 days" compares against the 30
 * before it, "last 90" against the 90 before that, "this year" against last
 * year, and a custom range against the equivalent span before it.
 *
 * Returns null for "all time" — an unbounded window has no previous counterpart,
 * and faking one would make the delta meaningless. The client uses the null to
 * suppress the arrows rather than render a fake number.
 *
 * Built from day arithmetic on the resolved bounds, NOT by re-resolving a period
 * kind, because `custom` has no kind to re-resolve and because deriving from the
 * resolved dates is the only way the comparison can never drift out of step with
 * the window actually being displayed.
 */
export function previousPeriod(period: ResolvedPeriod): ResolvedPeriod | null {
  if (period.kind === "all") return null;
  const lengthMs = period.to.getTime() - period.from.getTime();
  if (lengthMs <= 0) return null;
  const from = new Date(period.from.getTime() - lengthMs);
  const to = new Date(period.from);
  return { ...period, from, to, fromStr: dayKey(from), toStr: dayKey(to) };
}

/**
 * Parses a `?period=` query value, defaulting to today.
 *
 * "week" is accepted even though it is no longer offered as a tab: bookmarks and
 * shared links from before it was removed would otherwise fall through to the
 * default anyway, but accepting it explicitly keeps `resolvePeriod` in charge of
 * what it means rather than an accidental default.
 */
export function parsePeriodKind(value: string | null | undefined): PeriodKind {
  if (value === "week") return "week";
  // Cast to ReadonlySet rather than calling .includes: PERIOD_KINDS is a
  // `as const` tuple whose element type excludes "week", so .includes() refuses
  // a plain PeriodKind argument.
  const known: ReadonlySet<string> = new Set(PERIOD_KINDS);
  return known.has(value ?? "") ? (value as PeriodKind) : "today";
}

/**
 * The reporting windows offered on the dashboard.
 *
 * "week" was removed from the tab list at the user's request — "Last 7 days"
 * covers the same ground and the rolling set reads more consistently. It is still
 * a valid `PeriodKind` and `resolvePeriod` still handles it, so an old
 * `?period=week` link keeps working; only the button is gone.
 */
export const PERIOD_KINDS = [
  "today",
  "last3",
  "last7",
  "last14",
  "last30",
  "last90",
  "month",
  "year",
  "all",
  "custom",
] as const satisfies readonly PeriodKind[];

/**
 * Resolves the rolling "last N days" windows.
 *
 * `to` is EXCLUSIVE everywhere it is consumed (`createdAt: { lt }` in
 * clientWhere), so the upper bound is tomorrow's midnight — not today's. Using
 * today would silently drop every client registered earlier on the final day of
 * the window, which is how a "last 7 days" view quietly covered only 6.
 */
function rollingWindow(days: number, now: Date): ResolvedPeriod {
  const from = startOfBusinessDay(addBusinessDays(dayKey(now), -(days - 1)));
  const to = startOfNextBusinessDay(dayKey(now));
  return { from, to, fromStr: dayKey(from), toStr: dayKey(to) } as ResolvedPeriod;
}
