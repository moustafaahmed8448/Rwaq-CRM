import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { type ActivityEntry, type ClientData, type MarketingMetric, makeActivityEntry } from "./types";
import { normalizeStatus } from "./reporting";
import { identityKey, type BaselineClient } from "./import-clients";
import { sanitizePrefs, type ColumnPrefs } from "./client-columns";
import { sanitizeMarketingPrefs } from "./marketing-columns";
import { sanitizeUserPrefs } from "./user-columns";
import { addBusinessDays, businessDayKey, startOfBusinessDay, startOfBusinessToday } from "./business-days";

/**
 * Postgres is the single source of truth. Every read and write in the app goes
 * through this module so local dev and Vercel behave identically.
 */

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function requireDatabase(): void {
  if (!process.env.DATABASE_URL) {
    throw new ConfigurationError(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a PostgreSQL database (DATABASE_URL pooled, DATABASE_URL_UNPOOLED direct), then run `npx prisma db push` and `npx prisma db seed`.",
    );
  }
}

/** Turn any thrown value into a message safe to return to the browser. */
export function databaseErrorMessage(error: unknown): string {
  if (error instanceof ConfigurationError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? raw;
  return firstLine.length > 300 ? `${firstLine.slice(0, 300)}…` : firstLine;
}

/* ── Reference data (channels / statuses / locations) ─────────────────────── */

export type SettingKey = "channels" | "statuses" | "locations" | "logo" | "optionColors" | "statusBuckets" | "statusLabels";

export async function readSetting(key: SettingKey): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return Array.isArray(row?.value) ? (row.value as string[]) : [];
}

export async function addSettingValue(key: SettingKey, value: string): Promise<void> {
  const current = await readSetting(key);
  if (current.some((v) => String(v).toLowerCase() === value.toLowerCase())) return;
  const next = [...current, value];
  await prisma.setting.upsert({
    where: { key },
    update: { value: next },
    create: { key, value: next },
  });
}

export async function removeSettingValue(key: SettingKey, value: string): Promise<void> {
  const current = await readSetting(key);
  const next = current.filter((v) => v !== value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: next },
    create: { key, value: next },
  });
}

/* ── Scalar settings (single value, e.g. the dashboard logo) ───────────────────
   The array helpers above are for reference data. The logo is a single string,
   so it gets its own scalar pair rather than being shoehorned into a one-item
   array. */

export async function readSettingValue(key: SettingKey): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return typeof row?.value === "string" && row.value.length > 0 ? row.value : null;
}

export async function writeSettingValue(key: SettingKey, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function clearSettingValue(key: SettingKey): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

/* ── Object settings (e.g. the admin-set reference-option colours) ───────────
   A third shape, alongside the string arrays and the single-string scalars: the
   "optionColors" row holds { statuses: {…}, channels: {…}, locations: {…} }. It
   is kept in its own key rather than folded into the existing arrays precisely
   so the array contract above — and every reader of it — stays untouched, and so
   colouring an option needs no migration. */

export async function readSettingObject(key: SettingKey): Promise<Record<string, unknown> | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  // Guard the shape: an array would satisfy a naive `typeof === "object"` check
  // and then be indexed by kind, yielding undefined everywhere.
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) return null;
  return row.value as Record<string, unknown>;
}

export async function writeSettingObject(
  key: SettingKey,
  value: Record<string, unknown>,
): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
}

/* ── Saved filter views (per user) ────────────────────────────────
   Stored in the existing `Setting` table under `savedViews:<username>` rather
   than in a new AppUser column.

   That is a deliberate choice over a dedicated column: a saved view is user
   data that arrived after the column-based layout work was finished, and the
   repo's own history (prisma/sql/008, 009) is that every new AppUser field
   costs a migration plus a manual psql step on each environment. `Setting` is
   already the workspace's key/value escape hatch for exactly this shape of
   data — the reference lists, the colour map and the status buckets all live
   there — so a saved view is the same kind of thing with a per-user key.

   Keying by username rather than storing one shared blob also means two people
   can have genuinely different views without a merge rule, and deleting a view
   touches one row instead of rewriting a shared array. */
export type SavedView = {
  /** Stable id, so a rename does not look like a delete + create. */
  id: string;
  name: string;
  /** The filter state to restore. Shape mirrors Filters in client-types.ts. */
  filters: SavedViewFilters;
  createdAt: string;
};

/**
 * Only the keys a saved view may carry.
 *
 * Explicit rather than `Filters` so a stored view cannot smuggle in a key the
 * client does not know how to restore — the payload is user-editable JSON, and
 * `Object.assign`-ing an unknown key into live filter state is how a saved view
 * ends up silently controlling something invisible.
 */
export type SavedViewFilters = {
  query?: string;
  status?: string[];
  channel?: string[];
  location?: string[];
  firstContact?: string[];
  secondContact?: string[];
  followUp?: string;
  startDate?: string;
  endDate?: string;
};

const MAX_VIEWS = 30;
const MAX_NAME = 60;
const savedViewsKey = (username: string) =>
  `savedViews:${String(username ?? "").trim().toLowerCase()}`;

/** Coerces one stored entry, dropping it if any part is unusable. */
function coerceSavedView(raw: unknown): SavedView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_NAME) : "";
  if (!name || !entry.filters || typeof entry.filters !== "object") return null;

  const f = entry.filters as Record<string, unknown>;
  const listOf = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
  const text = (v: unknown): string | undefined =>
    typeof v === "string" ? v.slice(0, 200) : undefined;

  return {
    id: typeof entry.id === "string" && entry.id ? entry.id.slice(0, 40) : name,
    name,
    filters: {
      query: text(f.query),
      status: listOf(f.status),
      channel: listOf(f.channel),
      location: listOf(f.location),
      firstContact: listOf(f.firstContact),
      secondContact: listOf(f.secondContact),
      followUp: text(f.followUp),
      startDate: text(f.startDate),
      endDate: text(f.endDate),
    },
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
  };
}

export async function readSavedViews(username: string): Promise<SavedView[]> {
  const row = await prisma.setting.findUnique({ where: { key: savedViewsKey(username) } });
  if (!Array.isArray(row?.value)) return [];
  return (row.value as unknown[])
    .map(coerceSavedView)
    .filter((v): v is SavedView => v !== null)
    .slice(0, MAX_VIEWS);
}

export async function writeSavedViews(username: string, views: SavedView[]): Promise<void> {
  const value = views.slice(0, MAX_VIEWS);
  await prisma.setting.upsert({
    where: { key: savedViewsKey(username) },
    update: { value: value as unknown as Prisma.InputJsonValue },
    create: { key: savedViewsKey(username), value: value as unknown as Prisma.InputJsonValue },
  });
}

/** Reads, mutates and writes back — one round trip, so a lost update is far less likely. */
export async function mutateSavedViews(
  username: string,
  mutate: (views: SavedView[]) => SavedView[],
): Promise<SavedView[]> {
  const current = await readSavedViews(username);
  const next = mutate(current).slice(0, MAX_VIEWS);
  await writeSavedViews(username, next);
  return next;
}

/* ── Reference-option rename (admin) ───────────────────────────────────────
   A reference value is not a foreign key — it is a plain string copied onto
   every Client row. Renaming one therefore means rewriting that string
   everywhere it was stored, which is why this cannot be a Setting-only edit:
   leaving the clients behind would strand them on a value that no longer exists
   anywhere in the UI, which is exactly what the delete guard exists to prevent.

   Everything runs in ONE transaction. A partial rename (clients rewritten, list
   not, or vice versa) is worse than no rename at all, so either all of it
   applies or none of it does. */

export type RenameField = "status" | "acquisitionChannel" | "location";

export type RenameOutcome =
  | { ok: true; clients: number; metrics: number }
  | { ok: false; reason: "collision"; label: string };

/**
 * Renames a reference value across every place it is stored.
 *
 * `actor` is threaded into the activity log so the timeline on each affected
 * client shows who changed it and what it changed from — a silent bulk rewrite
 * of 300 rows would otherwise be invisible to everyone who owns those clients.
 *
 * Locations match case-insensitively (matching every other location guard in
 * the app); status and channel match exactly, because those are stored as
 * upper-cased tokens and folding case would silently rewrite rows the admin did
 * not ask about.
 */
export async function renameOptionValue(
  field: RenameField,
  from: string,
  to: string,
  actor: string,
): Promise<RenameOutcome> {
  const clientWhere =
    field === "location"
      ? { [field]: { equals: from, mode: "insensitive" as const } }
      : { [field]: from };

  // Pre-flight, inside the transaction: a channel rename can violate
  // MarketingMetric's @@unique([startDate, endDate, channel]). Detecting it
  // first turns a mid-write constraint error into a clean refusal.
  if (field === "acquisitionChannel") {
    const clash = await prisma.marketingMetric.findFirst({
      where: { channel: to, NOT: { channel: from } },
      select: { id: true },
    });
    if (clash) return { ok: false, reason: "collision", label: to };
  }

  const affected = await prisma.client.findMany({
    where: clientWhere,
    select: { id: true, activityLog: true },
  });

  await prisma.$transaction(async (tx) => {
    // Per-row rather than one updateMany: each row's activityLog has to be
    // appended to individually, and a single updateMany cannot express that.
    // Batched so a rename touching hundreds of clients is still a handful of
    // round-trips instead of one per client.
    const BATCH = 50;
    for (let i = 0; i < affected.length; i += BATCH) {
      const slice = affected.slice(i, i + BATCH);
      await Promise.all(
        slice.map((row) => {
          const log = Array.isArray(row.activityLog) ? (row.activityLog as unknown as ActivityEntry[]) : [];
          const entry = makeActivityEntry(
            field === "status" ? "STATUS_CHANGE" : "FIELD_EDIT",
            actor,
            { field, oldValue: from, newValue: to },
          );
          return tx.client.update({
            where: { id: row.id },
            data: {
              [field]: to,
              activityLog: [...log, entry] as unknown as Prisma.InputJsonValue,
            },
          });
        }),
      );
    }

    if (field === "acquisitionChannel") {
      await tx.marketingMetric.updateMany({ where: { channel: from }, data: { channel: to } });
    }
  });

  return {
    ok: true,
    clients: affected.length,
    metrics: field === "acquisitionChannel" ? await prisma.marketingMetric.count({ where: { channel: to } }) : 0,
  };
}

/* ── Clients ─────────────────────────────────────────────────────────────── */

export type ClientRow = {
  id: string;
  createdAt: string;
  lastUpdateDate: string;
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  notes: string | null;
  /** ISO string, or null when no follow-up is set. Matches createdAt/lastUpdateDate. */
  nextFollowUpAt: string | null;
  archived: boolean;
  archivedAt: string | null;
  activityLog: ActivityEntry[];
};

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

type ClientRecordDb = Prisma.ClientGetPayload<Record<string, never>>;

export function toClientRow(row: ClientRecordDb): ClientRow {
  return {
    id: row.id,
    createdAt: iso(row.createdAt) ?? "",
    lastUpdateDate: iso(row.lastUpdateDate) ?? "",
    name: row.name,
    phoneNumber: row.phoneNumber,
    status: normalizeStatus(row.status),
    project: row.project,
    location: row.location,
    acquisitionChannel: row.acquisitionChannel,
    operationToTake: row.operationToTake,
    firstContactPerson: row.firstContactPerson,
    secondContactPerson: row.secondContactPerson,
    notes: row.notes,
    // `iso` so the row shape matches `createdAt` / `lastUpdateDate`, which are
    // strings for the JSON API. Emitting a raw Date here would serialize the
    // same either way, but the two representations differing is exactly the kind
    // of drift that later breaks a comparison.
    nextFollowUpAt: iso(row.nextFollowUpAt),
    archived: Boolean(row.archived),
    archivedAt: iso(row.archivedAt),
    activityLog: Array.isArray(row.activityLog)
      ? (row.activityLog as unknown as ActivityEntry[])
      : [],
  };
}

/** The four follow-up buckets the clients filter offers. */
export type FollowUpFilter = "overdue" | "today" | "upcoming" | "none";

export type ClientFilters = {
  /**
   * Each of these accepts a single value OR a list. A list ORs within the field
   * while still ANDing with the other fields — the same semantics as
   * matchesFilters() in src/app/page.tsx, which the filter bar has always used.
   * A single string is kept working so the existing callers (analytics, options
   * usage counts, the archived page) need no change.
   */
  channel?: string | string[];
  status?: string | string[];
  location?: string | string[];
  /**
   * Restrict to clients whose FIRST contact matches. Composes with
   * `secondContact` as AND, so `first=A&second=B` narrows to the pairing rather
   * than the union.
   */
  firstContact?: string | string[];
  /** Restrict to clients whose SECOND contact matches. See `firstContact`. */
  secondContact?: string | string[];
  /**
   * Restrict to clients where this person is the 1st or 2nd contact. Used to
   * scope Sales/CRM users to their own book. Matched with `equals` rather than
   * `contains` (unlike the user-typed `salesperson` filter above) so a user
   * named "Ann" never inherits clients belonging to "Anna".
   */
  assignee?: string;
  /**
   * Only clients created within [createdFrom, createdTo). This is what makes the
   * dashboard's period figures line up: spend and client counts then describe the
   * same window instead of one being this week and the other all of time.
   */
  createdFrom?: string;
  createdTo?: string;
  archived?: boolean;
  includeArchived?: boolean;
  /**
   * Follow-up bucket: `overdue` (a date has passed), `today` (due on the current
   * day, including anything already late today), `upcoming` (a future date), or
   * `none` (no date set at all).
   *
   * Deliberately a closed set rather than a raw date range: every one of these is
   * a question the user asks in the course of a day ("what did I miss?", "what's
   * on for today?"), and expressing them as ranges in the query string would put
   * the boundary arithmetic in the caller, where it would be recomputed per
   * request and could disagree with the count the header shows.
   */
  followUp?: FollowUpFilter;
  /**
   * Which contact ROLE the assignee holds on the client: `first`, `second`, or
   * neither. Only meaningful alongside `assignee`.
   *
   * Narrowing to a role rather than to a name is what makes "clients I own" and
   * "clients I support" answerable without the caller restating the assignee.
   */
  contact?: "first" | "second";
  /**
   * Free-text search over name / phone / project / notes.
   *
   * Digits are compared digit-only on the phone column so "1018240912" finds
   * "+20 101 824 0912" — the same normalization matchesFilters() applied in the
   * browser before this moved server-side. Without it a search would silently
   * stop finding rows that the old client-side filter found, which is worse than
   * no search at all.
   *
   * PostgreSQL has no portable "strip all non-digits" in a `contains`, so the
   * comparison normalizes both sides in JS and ORs the fields.
   */
  search?: string;
};

/**
 * Normalises `where.AND` to an array so a clause can be appended without
 * discarding the ones already there.
 *
 * This exists because three different filters (assignee, location list, free
 * text) each contribute an OR group, and Prisma's `AND` accepts either a single
 * object or an array. Assigning `where.AND = [...]` blindly at each site is how
 * the location filter silently vanished the moment a search was also active.
 */
function existingAnd(where: Prisma.ClientWhereInput): Prisma.ClientWhereInput[] {
  const current = where.AND;
  if (Array.isArray(current)) return current;
  return current ? [current] : [];
}

export function clientWhere(filters: ClientFilters): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = {};
  // Normalises the string-or-list fields to an array. "ALL" is the filter bar's
  // sentinel for "no filter" and must not become a literal value.
  const asList = (value: string | string[] | undefined): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).filter(
      (v) => v && v !== "ALL",
    );

  // Status, channel and location all filter the same way: an OR of exact,
// case-insensitive equality tests per value, folded into AND.
//
// Written as OR-of-equals rather than `{ in: [...] }` because Prisma's `in`
// cannot take a case-insensitive mode — `in` is always exact. With `in`, a
// client stored "Riyadh" dropped out of a "riyadh" filter, and any value whose
// casing differed from the stored column vanished silently. The OR form matches
// on case, so a filter can never disagree with the dropdown it was chosen from.
//
// Pushed into AND rather than assigned to where.OR, because `search` also
// contributes an OR group below and one would overwrite the other.
  const anyOf = (field: string, values: string[]): Prisma.ClientWhereInput =>
    ({ OR: values.map((v) => ({ [field]: { equals: v, mode: "insensitive" } })) });

  const channels = asList(filters.channel);
  const statuses = asList(filters.status);
  const locations = asList(filters.location);
  const groups: Prisma.ClientWhereInput[] = [];
  if (channels.length > 0) groups.push(anyOf("acquisitionChannel", channels));
  if (statuses.length > 0) groups.push(anyOf("status", statuses));
  if (locations.length > 0) groups.push(anyOf("location", locations));
  if (groups.length > 0) where.AND = [...existingAnd(where), ...groups];
  // 1st and 2nd contact are separate filters that AND together, so selecting a
  // 1st and a 2nd contact narrows to clients held by that exact pairing. Same
  // OR-of-equals treatment as status/channel — `in` plus `mode` is not a valid
  // Prisma filter, so it was silently ignored.
  const firstContacts = asList(filters.firstContact);
  if (firstContacts.length > 0) where.firstContactPerson = { in: firstContacts };
  const secondContacts = asList(filters.secondContact);
  if (secondContacts.length > 0) where.secondContactPerson = { in: secondContacts };
  /* Which ROLE the assignee holds: `first`, `second`, or neither.
     Deliberately separate from the two filters above. Those narrow to a NAMED
     person's clients; this narrows to a ROLE within the book already scoped by
     `assignee`, which is what the profile page's tiles need — "clients I own"
     and "clients I support" are different questions from "clients of X". */
  if (filters.contact === "first") where.firstContactPerson = { equals: filters.assignee ?? "" };
  else if (filters.contact === "second") where.secondContactPerson = { equals: filters.assignee ?? "" };
  if (filters.assignee) {
    // AND, not OR: this has to compose with an explicit salesperson filter
    // rather than overwrite it.
    where.AND = [
      ...existingAnd(where),
      {
        OR: [
          { firstContactPerson: { equals: filters.assignee, mode: "insensitive" } },
          { secondContactPerson: { equals: filters.assignee, mode: "insensitive" } },
        ],
      },
    ];
  }
  if (filters.archived) where.archived = true;
  else if (!filters.includeArchived) where.archived = false;
  if (filters.createdFrom || filters.createdTo) {
    /* Business-day midnights, not this host's. `new Date(y, m, d)` resolved to
       UTC on Vercel, three hours later than the day the user meant, which is why
       the header badge and this count disagreed on the same filter.
       See src/lib/business-days.ts. */
    where.createdAt = {
      ...(filters.createdFrom ? { gte: startOfBusinessDay(filters.createdFrom) } : {}),
      /* The upper bound is the start of the day AFTER `to`, so the end date is
         included in full. This used to be `lt: startOfLocalDay(to)`, which
         compared against midnight ON the end date and so silently dropped every
         client registered during it — "1st to 5th" really meant "1st to 4th". */
      ...(filters.createdTo ? { lt: startOfBusinessDay(addBusinessDays(filters.createdTo, 1)) } : {}),
    };
  }
  /* Follow-up buckets.
     Boundaries are LOCAL midnights, matching how the form writes the date and how
     `isOverdue` reads it back. Doing this in SQL rather than filtering the
     returned rows matters: the paged table needs a `total` for the pager, and a
     count taken after paging would report only the rows on screen. */
  if (filters.followUp) {
    /* Business-day midnights, computed in BUSINESS_TZ rather than the host's
       clock. On Vercel, `setHours(0,0,0,0)` meant UTC midnight — three hours
       into the previous Riyadh day — so "due today" started at 21:00Z and
       disagreed with the browser's own `isOverdue`, which reads the user's day. */
    const todayStart = startOfBusinessToday();
    const tomorrowStart = startOfBusinessDay(addBusinessDays(businessDayKey(todayStart), 1));
    switch (filters.followUp) {
      case "overdue":
        // Strictly before today. A follow-up for later TODAY is still ahead of
        // the user, so it belongs in "due today", not here.
        where.nextFollowUpAt = { lt: todayStart };
        break;
      case "today":
        where.AND = [...existingAnd(where), { nextFollowUpAt: { gte: todayStart, lt: tomorrowStart } }];
        break;
      case "upcoming":
        where.AND = [...existingAnd(where), { nextFollowUpAt: { gte: tomorrowStart } }];
        break;
      case "none":
        where.nextFollowUpAt = null;
        break;
    }
  }
  if (filters.search) {
    const q = filters.search.trim();
    if (q) {
      // Same folding matchesFilters() used in the browser: spaces, dashes and
      // parentheses are ignored so a phone matches however it was typed. The
      // text fields get a plain case-insensitive contains; the phone gets the
      // digits-only comparison.
      const text = q.replace(/[\s\-().]/g, "");
      const clauses: Prisma.ClientWhereInput[] = [
        { name: { contains: q, mode: "insensitive" } },
        { project: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ];
      // The phone is matched BOTH ways, because Postgres compares the stored
      // string as-is: a stored "+20 101 824 0912" would never match `contains`
      // "1018240912". Comparing the punctuation-stripped query covers the common
      // case; including the raw query means a partially-typed fragment like
      // "+20 101" still matches. A true digits-insensitive match against the
      // STORED side would need a functional index (SQL 006) — noted rather than
      // silently approximated.
      if (text) clauses.push({ phoneNumber: { contains: text } });
      if (q) clauses.push({ phoneNumber: { contains: q, mode: "insensitive" } });
      // Folded in as AND so it composes with the assignee/date/location clauses
      // above, rather than overwriting where.AND.
      where.AND = [...existingAnd(where), { OR: clauses }];
    }
  }
  return where;
}

export async function listClients(filters: ClientFilters = {}): Promise<ClientRow[]> {
  const rows = await prisma.client.findMany({
    where: clientWhere(filters),
    orderBy: { lastUpdateDate: "desc" },
  });
  return rows.map(toClientRow);
}

/* ── Paged client listing (the clients table) ─────────────────────────────────
   `listClients` above returns EVERY matching row and is what the dashboard, the
   kanban and the reference-option usage counts depend on. It must keep doing
   that: those figures describe the whole book, so silently paging them would
   make the KPI cards disagree with the funnel.

   This sibling exists purely so the clients TABLE can fetch one screen at a
   time. Before it, every page view downloaded all 337 clients — ~270 KB
   uncompressed, most of it the per-row activityLog that the table never renders.
   The detail page already fetches one client on its own, so dropping
   activityLog here costs the table nothing. */

export type ClientPage = {
  rows: ClientRow[];
  /** Total rows matching the filter, ignoring the page window. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type ClientSort = "recent" | "oldest" | "registered" | "registeredOldest";

/** Page size bounds. The cap stops a hand-crafted ?pageSize=100000 from becoming
    a denial-of-service on our own database. */
const MAX_PAGE_SIZE = 200;

/**
 * One page of clients, plus the total match count the pager needs.
 *
 * The count is fetched alongside rather than as `rows.length`, because the
 * pager needs to know how many pages exist — not how many rows came back.
 *
 * `orderBy` mirrors sortClients() in src/app/page.tsx exactly. Numeric ids
 * compare as numbers so id 9 sorts before id 10; the same tie-breaker applies
 * here or the two disagree on the "recent" order for rows saved together.
 */
export async function listClientsPaged(
  filters: ClientFilters,
  options: { page?: number; pageSize?: number; sort?: ClientSort } = {},
): Promise<ClientPage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), MAX_PAGE_SIZE);
  // Clamped to >= 1 so a negative or NaN ?page= yields page 1 rather than a
  // negative OFFSET, which Postgres rejects.
  const requested = Number(options.page ?? 1);
  const page = Number.isFinite(requested) ? Math.max(Math.floor(requested), 1) : 1;

  const orderBy: Prisma.ClientOrderByWithRelationInput[] =
    options.sort === "oldest"
      ? [{ lastUpdateDate: "desc" }, { id: "asc" }]
      : options.sort === "registered"
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : options.sort === "registeredOldest"
          ? [{ createdAt: "asc" }, { id: "asc" }]
          // Default matches the order `listClients` already returns, so the
          // first page of the table is unchanged by this work.
          : [{ lastUpdateDate: "desc" }, { id: "desc" }];

  const where = clientWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.client.count({ where }),
  ]);

  return {
    rows: rows.map(toClientRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

/**
 * Just the ids matching a filter.
 *
 * Backs "select all N matching" on the clients table. Selecting 200 rows must not
 * cost 200 full client records (each with its activity log) just to learn which
 * ids they are — this selects the single `id` column instead.
 */
export async function listClientIds(filters: ClientFilters): Promise<{ rows: never[]; ids: string[]; total: number; page: number; pageSize: number; pageCount: number }> {
  const where = clientWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.client.findMany({ where, select: { id: true }, orderBy: { lastUpdateDate: "desc" } }),
    prisma.client.count({ where }),
  ]);
  return {
    rows: [] as never[],
    ids: rows.map((r) => r.id),
    total,
    page: 1,
    pageSize: total,
    pageCount: 1,
  };
}

export async function findClient(id: string): Promise<ClientRow | null> {
  const row = await prisma.client.findUnique({ where: { id } });
  return row ? toClientRow(row) : null;
}

export async function countClients(where: Prisma.ClientWhereInput = {}): Promise<number> {
  return prisma.client.count({ where });
}

/**
 * Counts for all four follow-up buckets, under the same filters as the list.
 *
 * The four chips in the clients filter bar render these, and the point of that is
 * legibility: a chip showing nothing beside "Overdue" is indistinguishable from
 * one that is not filtering. With 0 of 343 clients carrying a date, Overdue and
 * Due today are legitimately empty, and the number is what makes that obvious
 * rather than looking broken.
 *
 * Each bucket is counted by running `clientWhere` with that bucket applied, so a
 * badge can never disagree with the rows the filter returns — the boundaries are
 * local midnights, exactly as the list uses them. Four cheap COUNTs, one request.
 */
export async function countClientsByFollowUp(
  filters: ClientFilters = {},
): Promise<Record<FollowUpFilter, number>> {
  const buckets: FollowUpFilter[] = ["overdue", "today", "upcoming", "none"];
  const counts = {} as Record<FollowUpFilter, number>;
  for (const bucket of buckets) {
    counts[bucket] = await countClients(clientWhere({ ...filters, followUp: bucket }));
  }
  return counts;
}

export type NewClientInput = {
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  notes?: string;
  /**
   * When the client should next be chased.
   *
   * Accepts an ISO string or a Date because the two arrive from different
   * places: a JSON body from the browser carries the former, an importer or a
   * seed script naturally builds the latter. Stored as timestamptz; cleared by
   * passing null.
   */
  nextFollowUpAt?: string | Date | null;
};

/**
 * Next sequential client id ("1", "2", …). Clients are numbered from 1 in
 * creation order; ids are never reused after a delete (max + 1). Rows still
 * holding pre-migration uuids are ignored so numbering stays safe even
 * before prisma/sql/002_client_numeric_ids.sql has been run.
 */
async function nextClientId(): Promise<string> {
  const rows = await prisma.client.findMany({ select: { id: true } });
  let max = 0;
  for (const row of rows) {
    if (/^\d+$/.test(row.id)) {
      const n = Number(row.id);
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
  }
  return String(max + 1);
}

/**
 * Inserts the row, retrying a few times when two concurrent inserts race for
 * the same sequential id (unique-key violation). Any other error is rethrown.
 */
async function insertClient(input: NewClientInput, log: ActivityEntry[]) {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.client.create({
        data: {
          ...input,
          id: await nextClientId(),
          notes: input.notes ?? null,
          activityLog: log as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const collided = /unique|duplicate key/i.test(msg);
      if (!collided || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

export async function createClient(input: NewClientInput, actor: string): Promise<ClientRow> {
  // The activity entry stores no prose: the UI builds the localized sentence
  // from `action` (see describeActivity in src/lib/reporting.ts).
  const log: ActivityEntry[] = [makeActivityEntry("CREATED", actor)];
  // Two admins creating at the same instant can compute the same next id, so
  // retry on a unique-key violation until a free number is found.
  const row = await insertClient(input, log);

  // Notify anyone newly assigned as a contact person. The contact role rides
  // along in the type so the message can be localized at render time (see
  // notificationMessage in src/lib/reporting.ts).
  const contacts: Array<{ person?: string; contact: "1st" | "2nd" }> = [
    { person: input.firstContactPerson, contact: "1st" },
    { person: input.secondContactPerson, contact: "2nd" },
  ];
  for (const { person, contact } of contacts) {
    if (person) {
      await createNotification({
        recipient: person,
        type: `ASSIGNED:${contact}`,
        // Legacy English fallback for clients that don't localize yet.
        message: `You were assigned \u201c${input.name}\u201d`,
        clientId: row.id,
        clientName: input.name,
      });
    }
  }

  return toClientRow(row);
}

/* ── Bulk import ──────────────────────────────────────────────────────────── */

export type BulkClientInput = {
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  /** تاريخ التسجيل from the source sheet; falls back to "now" when absent. */
  createdAt: Date;
};

export type BulkImportResult = { imported: number; firstId: string; lastId: string };

/** Rows per INSERT. Large enough to be quick, small enough for one statement. */
const BULK_CHUNK = 100;

/**
 * Inserts many clients in one pass.
 *
 * Deliberately does NOT loop `createClient`. That helper re-reads every id in
 * the table to compute the next one, so 344 rows would mean 344 full scans, and
 * it fires up to two "you were assigned a client" notifications per row — 688
 * rows against a 300-row notification table, which would silently delete the
 * workspace's existing notifications. Here the starting id is computed once,
 * the numbers are handed out from a counter, and each row gets a single CREATED
 * activity entry so the client timeline still explains where the row came from.
 *
 * Ids are reserved in a transaction up front and the whole insert is a second
 * transaction, so a failure part-way cannot leave the counter and the rows
 * disagreeing about what already exists.
 */
export async function bulkImportClients(
  rows: BulkClientInput[],
  actor: string,
): Promise<BulkImportResult> {
  if (rows.length === 0) return { imported: 0, firstId: "", lastId: "" };

  const [first, imported] = await prisma.$transaction(async (tx) => {
    // Mirrors nextClientId(): highest numeric id + 1, ignoring legacy uuid rows.
    const existing = await tx.client.findMany({ select: { id: true } });
    let max = 0;
    for (const row of existing) {
      if (/^\d+$/.test(row.id)) {
        const n = Number(row.id);
        if (Number.isSafeInteger(n) && n > max) max = n;
      }
    }

    const start = max + 1;
    const data = rows.map((row, index) => ({
      id: String(start + index),
      name: row.name,
      phoneNumber: row.phoneNumber,
      status: row.status,
      project: row.project,
      location: row.location,
      acquisitionChannel: row.acquisitionChannel,
      operationToTake: row.operationToTake,
      firstContactPerson: row.firstContactPerson,
      secondContactPerson: row.secondContactPerson,
      notes: null,
      createdAt: row.createdAt,
      // Same entry createClient writes, so the timeline reads identically.
      activityLog: [makeActivityEntry("CREATED", actor)] as unknown as Prisma.InputJsonValue,
    }));

    for (let i = 0; i < data.length; i += BULK_CHUNK) {
      await tx.client.createMany({ data: data.slice(i, i + BULK_CHUNK) });
    }
    return [start, data.length] as const;
  });

  return {
    imported,
    firstId: String(first),
    lastId: String(first + imported - 1),
  };
}

/**
 * Registers reference values discovered by an import.
 *
 * `addSettingValue` is called per value rather than rewriting the whole array:
 * each call re-reads the row, so a concurrent edit from the settings screen
 * cannot be clobbered by a stale in-memory copy.
 */
export async function addSettingValues(key: SettingKey, values: string[]): Promise<void> {
  for (const value of values) await addSettingValue(key, value);
}

/**
 * Records an import run in the SyncRun table.
 *
 * Failures are swallowed: the log is diagnostic, and a missing audit row must
 * never turn a successful import into an error for the user.
 */
export async function recordSyncRun(input: {
  provider: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  error?: string;
}): Promise<void> {
  try {
    await prisma.syncRun.create({
      data: {
        provider: input.provider,
        direction: "import",
        status: input.status,
        recordsRead: input.recordsRead,
        recordsWritten: input.recordsWritten,
        error: input.error ?? null,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
  } catch {
    // Non-fatal, as above.
  }
}

/**
/**
 * Every client, shaped for the sheet importer to diff against.
 *
 * `existingClientKeys` answers only "is this person already here?", which is
 * enough to avoid duplicates but cannot show a before/after. This returns the
 * stored values so the import screen can show which fields actually disagree.
 *
 * Archived clients are included: a sheet row matching one must be recognised as
 * the same person, or the import would create a duplicate of a record the user
 * deliberately archived. The planner flags them instead of hiding them.
 */
export async function listImportBaseline(): Promise<BaselineClient[]> {
  const rows = await prisma.client.findMany({
    select: {
      id: true, name: true, phoneNumber: true, status: true, project: true,
      location: true, acquisitionChannel: true, operationToTake: true,
      firstContactPerson: true, secondContactPerson: true, archived: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phoneNumber: r.phoneNumber,
    // Normalised so it compares against an already-mapped sheet status; the
    // stored value can be a legacy spelling of the same stage.
    status: normalizeStatus(r.status),
    project: r.project,
    location: r.location,
    acquisitionChannel: r.acquisitionChannel,
    operationToTake: r.operationToTake,
    firstContactPerson: r.firstContactPerson,
    secondContactPerson: r.secondContactPerson,
    archived: Boolean(r.archived),
  }));
}

export type ClientPatch = Partial<NewClientInput> & { archived?: boolean };

/* ── Duplicate detection & merge ──────────────────────────────────
   Two clients are treated as the same lead when their phone numbers reduce to
   the same digits. That is the one field in this schema that is effectively an
   identity: a number typed as "+20 101 824 0912", "01018240912" and "1018240912"
   is the same person, and all three variants occur in real data.

   Name is NOT used as an identity signal on its own — family and shared business
   names are common here, so two rows called "Mohammed" are far more likely to be
   two different people than one person entered twice. Name-only groups are still
   reported, but as a weaker `reason` so the UI can present them for review rather
   than as an obvious merge. */

/** Digits only, with a leading Saudi `00`/`+` form normalised away. */
export function normalizePhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  return digits;
}

/** Why a group was flagged. `phone` is the confident one; see the note above. */
export type DuplicateReason = "phone" | "name";
export type DuplicateGroup = {
  reason: DuplicateReason;
  /** The normalised value the group matched on, shown as the group heading. */
  key: string;
  /** Oldest first, so the earliest record is the natural "primary". */
  clients: ClientRow[];
};

/**
 * Groups clients that look like the same lead.
 *
 * Loads the ACTIVE book (archived rows are excluded — an archived row is
 * deliberately out of the book, so pairing it with a live one would surface a
 * "duplicate" the user already resolved by archiving) and groups in memory.
 * The book is small enough that a round trip per candidate pair would be slower
 * and far more code than one scan.
 *
 * A group of one is dropped: a client with a unique phone is not a duplicate of
 * anything, and listing it would bury the real findings.
 */
export async function findDuplicates(includeArchived = false): Promise<DuplicateGroup[]> {
  const rows = await listClients(includeArchived ? {} : { includeArchived: false });
  const byPhone = new Map<string, ClientRow[]>();
  const byName = new Map<string, ClientRow[]>();

  for (const row of rows) {
    const phone = normalizePhone(row.phoneNumber);
    // A 4-digit "phone" is a placeholder, not a contact detail — grouping on those
    // would merge every row someone left blank.
    if (phone.length >= 7) {
      const list = byPhone.get(phone) ?? [];
      list.push(row);
      byPhone.set(phone, list);
    }
    const name = String(row.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (name.length >= 3) {
      const list = byName.get(name) ?? [];
      list.push(row);
      byName.set(name, list);
    }
  }

  const byId = (a: ClientRow, b: ClientRow) =>
    Number(a.id) - Number(b.id) || a.createdAt.localeCompare(b.createdAt);

  const groups: DuplicateGroup[] = [];
  for (const [key, list] of byPhone) {
    if (list.length > 1) groups.push({ reason: "phone", key, clients: [...list].sort(byId) });
  }
  for (const [key, list] of byName) {
    if (list.length > 1) {
      groups.push({ reason: "name", key, clients: [...list].sort(byId) });
    }
  }

  /* A phone group already covers every row in a matching-name group, so the
     name group is dropped rather than shown as a second, weaker copy of the same
     finding. Without this, one duplicated lead appears twice in the list and the
     admin merges it twice. */
  const covered = new Set(groups.filter((g) => g.reason === "phone").flatMap((g) => g.clients.map((c) => c.id)));
  return groups.filter((g) => g.reason === "phone" || !g.clients.every((c) => covered.has(c.id)));
}

/**
 * Fields a merge resolves by taking the first NON-EMPTY value, in the order the
 * rows are given.
 *
 * Empty loses, always. That rule is the whole merge: it means the result keeps the
 * notes, project and owner that only ONE of the two rows happened to have, instead
 * of the survivor's blanks silently erasing data the user had actually typed.
 * `status` is deliberately NOT in this list — "first non-empty" would mean the
 * older row's stage always wins, which is a business decision, not a data-recovery
 * one, so status is left exactly as the chosen survivor had it.
 */
const MERGE_FILL_DOWN = [
  "name",
  "phoneNumber",
  "project",
  "location",
  "acquisitionChannel",
  "operationToTake",
  "firstContactPerson",
  "secondContactPerson",
] as const;

export type MergeResult = {
  /** The row that survived. */
  survivorId: string;
  /** The rows that were folded into it and removed. */
  mergedIds: string[];
  /** Human-readable notes about what the merge did and skipped. */
  warnings: string[];
};

/**
 * Folds `sourceIds` into `primaryId`, then deletes the sources.
 *
 * Runs in ONE transaction. A partial merge is worse than no merge at all: it can
 * leave two rows sharing a phone number after the user was told they were merged,
 * and re-running the merge then produces a different answer than the first run.
 *
 * Refuses rather than guessing when the survivor is not in the set, and when any
 * id does not exist — silently merging N-1 of N would delete records with no way
 * to know which.
 */
export async function mergeClients(
  primaryId: string,
  sourceIds: string[],
  actor: string,
): Promise<MergeResult | null> {
  const primary = String(primaryId ?? "").trim();
  const sources = [...new Set(sourceIds.map((s) => String(s ?? "").trim()))].filter(
    (s) => s && s !== primary,
  );
  if (!primary || sources.length === 0) return null;

  return prisma.$transaction(async (tx) => {
    const rows = await tx.client.findMany({ where: { id: { in: [primary, ...sources] } } });
    if (rows.length !== sources.length + 1) return null;

    const survivor = rows.find((r) => r.id === primary)!;
    const others = sources.map((id) => rows.find((r) => r.id === id)!);

    const warnings: string[] = [];

    /* Fill-down, in a stable order: survivor first, then the sources oldest-first
       so the OLDEST source's value beats a newer one when both are set. That keeps
       the result deterministic — merging the same group twice gives the same
       row — which matters because the user may not notice a partial failure. */
    const ordered = [survivor, ...others.sort((a, b) => Number(a.id) - Number(b.id))];
    const data: Record<string, unknown> = {};
    for (const field of MERGE_FILL_DOWN) {
      const current = String((survivor as Record<string, unknown>)[field] ?? "").trim();
      if (current) continue;
      const found = ordered
        .map((r) => String((r as Record<string, unknown>)[field] ?? "").trim())
        .find(Boolean);
      if (found) {
        data[field] = found;
        warnings.push(`${field} filled from a merged record`);
      }
    }

    // Notes are concatenated, never replaced: they are free prose and two partial
    // notes are more useful than one of them. Duplicated text is dropped so
    // re-merging the same record twice does not double every sentence.
    const notes = [...new Set(
      ordered
        .map((r) => String(r.notes ?? "").trim())
        .filter(Boolean),
    )].join("\n\n");
    if (notes) data.notes = notes;

    /* Follow-up: the EARLIEST future date wins, falling back to any date at all.
       Taking the survivor's blindly would let a stale past date hide a fresher
       one; taking the latest would push a real deadline back. */
    const dates = ordered
      .map((r) => r.nextFollowUpAt)
      .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
    if (dates.length > 0) {
      const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
      if (!survivor.nextFollowUpAt || earliest.getTime() < survivor.nextFollowUpAt.getTime()) {
        data.nextFollowUpAt = earliest;
        warnings.push("follow-up date moved to the earliest of the merged records");
      }
    }

    /* Activity logs are concatenated oldest-first. The survivor's own entries keep
       their ids; a colliding id from a source is dropped rather than duplicated,
       because the list is keyed by id and two entries under one key render as one. */
    const mergedLog: unknown[] = [];
    const seen = new Set<string>();
    for (const row of [...others.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()), survivor]) {
      const log = Array.isArray(row.activityLog) ? row.activityLog : [];
      for (const entry of log as { id?: string }[]) {
        const id = String(entry?.id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        mergedLog.push(entry);
      }
    }
    mergedLog.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actor,
      action: "FIELD_EDIT",
      field: "mergedIds",
      newValue: sources.join(", "),
    });
    if (mergedLog.length > 0) data.activityLog = mergedLog as never;

    // The survivor keeps the OLDEST createdAt, so "when did we first hear about
    // this lead" survives a merge rather than resetting to the newest row's date.
    const earliestCreated = new Date(
      Math.min(...[survivor, ...others].map((r) => r.createdAt.getTime())),
    );
    data.createdAt = earliestCreated;

    await tx.client.update({ where: { id: primary }, data: data as never });
    await tx.client.deleteMany({ where: { id: { in: sources } } });

    return { survivorId: primary, mergedIds: sources, warnings };
  });
}

export type UpdateClientResult =
  | { outcome: "updated"; client: ClientRow }
  | { outcome: "not_found" }
  | { outcome: "no_changes" };

export type UpdateClientOptions = {
  /**
   * Set false for machine-driven writes. A sheet sync that reassigns the 1st/2nd
   * contact on fifty clients would otherwise fire fifty notifications at people
   * who never made the change.
   */
  notify?: boolean;
  /**
   * Database handle to run against. Defaults to the shared `prisma`.
   *
   * Exists for `bulkUpdateClients`, which needs every row in the batch to share
   * one transaction. Passing the transactional handle is the only way the writes
   * actually enlist — Prisma's callback form gives you a client bound to the
   * transaction, and a function that closes over the global `prisma` would
   * silently run outside it, which is the bug this option exists to prevent.
   */
  db?: PrismaClient;
};

export async function updateClient(
  id: string,
  patch: ClientPatch,
  actor: string,
  options: UpdateClientOptions = {},
): Promise<UpdateClientResult> {
  const db = options.db ?? prisma;
  const existing = await db.client.findUnique({ where: { id } });
  if (!existing) return { outcome: "not_found" };

  const { archived, ...rest } = patch;
  const updates: Prisma.ClientUpdateInput = {};
  const changes: Array<{ field: string; oldVal: string; newVal: string }> = [];
  const notify: Array<{ contact: "1st" | "2nd"; newVal: string }> = [];

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    const oldValue = (existing as unknown as Record<string, unknown>)[key];
    /* `nextFollowUpAt` is the one field whose STORED and INCOMING forms differ:
       the column reads back as a Date, while a browser sends an ISO string. A
       plain `String()` comparison would therefore never match, so re-saving the
       same date would log a phantom change and append a pointless activity entry
       every single time. Both sides are normalized to the same representation
       first — and `iso` maps null and undefined alike to null, so "cleared"
       compares equal to "never set", which is the intended reading. */
    const unchanged = key === "nextFollowUpAt"
      ? iso(typeof value === "string" ? new Date(value) : (value as Date | null))
        === iso(oldValue as Date | null)
      : String(oldValue ?? "") === String(value ?? "");
    if (unchanged) continue;
    (updates as Record<string, unknown>)[key] = value;
    // Store the raw column key (e.g. "acquisitionChannel") so the timeline can
    // localize the field name; never the English label.
    changes.push({ field: key, oldVal: String(oldValue ?? ""), newVal: String(value) });
    if (key === "firstContactPerson" || key === "secondContactPerson") {
      notify.push({ contact: key === "firstContactPerson" ? "1st" : "2nd", newVal: String(value) });
    }
  }

  const archiveChanged = archived !== undefined && archived !== Boolean(existing.archived);
  if (changes.length === 0 && !archiveChanged) return { outcome: "no_changes" };

  const extraActivity: ActivityEntry[] = [];
  if (archiveChanged) {
    updates.archived = archived;
    updates.archivedAt = archived ? new Date() : null;
    extraActivity.push(
      makeActivityEntry(archived ? "ARCHIVED" : "RESTORED", actor, { clientName: existing.name }),
    );
  }

  const previousLog = Array.isArray(existing.activityLog)
    ? (existing.activityLog as unknown as ActivityEntry[])
    : [];

  const nextLog: ActivityEntry[] = [
    ...previousLog,
    ...extraActivity,
    ...changes.map((c) =>
      makeActivityEntry(c.field === "status" ? "STATUS_CHANGE" : "FIELD_EDIT", actor, {
        field: c.field,
        oldValue: c.oldVal,
        newValue: c.newVal,
      }),
    ),
  ];

  const row = await db.client.update({
    where: { id },
    data: { ...updates, activityLog: nextLog as unknown as Prisma.InputJsonValue },
  });

  if (options.notify !== false) {
    for (const item of notify) {
      if (!item.newVal) continue;
    await createNotification({
      recipient: item.newVal,
      // The contact role rides along in the type so the message can be
      // localized at render time (see notificationMessage in reporting.ts).
      type: `ASSIGNED:${item.contact}`,
      // Legacy English fallback for clients that don't localize yet.
      message: `You were assigned \u201c${existing.name}\u201d`,
      clientId: id,
      clientName: existing.name,
      });
    }
  }

  return { outcome: "updated", client: toClientRow(row) };
}

/**
 * Applies one patch to many clients, atomically.
 *
 * Calls `updateClient` per id inside a single transaction rather than using
 * `prisma.client.updateMany`, and the reason is the activity log. `updateMany`
 * writes one UPDATE with no row access, so it cannot append the per-client
 * `STATUS_CHANGE` timeline entry or resolve each client's name for the
 * notification — both of which are part of what a status change IS in this app.
 * Reusing `updateClient` keeps one code path, so bulk and single edits cannot
 * drift apart in what they record.
 *
 * The transaction is what makes the batch all-or-nothing: 30 clients where one
 * is missing from the book should not leave 29 silently updated. Note the
 * per-id `updateClient` calls each issue their own find+update, so the
 * transaction guards atomicity, not round-trip count — which is the right
 * trade at the sizes this UI allows (one page of rows, or one filter match).
 */
export async function bulkUpdateClients(
  ids: string[],
  patch: ClientPatch,
  actor: string,
): Promise<{ updated: number; skipped: number }> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { updated: 0, skipped: 0 };

  /* Callback form, not the array form: the array form demands PrismaPromise
     query builders, and `updateClient` is an async function that awaits its own
     reads, so it returns a plain Promise. The callback form hands us a client
     already bound to the transaction, which is what `options.db` exists to
     accept — closing over the global `prisma` here would run every write
     outside the transaction and make the atomicity claim false.

     `notify: false` inside, deliberately. `createNotification` writes through the
     shared client, so it could not enlist even if we wanted it to, and a
     notification announcing a change that later rolls back is worse than one
     that never arrives. They are sent after the commit instead. */
  const outcomes = await prisma.$transaction(async (tx) => {
    const results: UpdateClientResult[] = [];
    for (const id of unique) {
      results.push(await updateClient(id, patch, actor, { db: tx as unknown as PrismaClient, notify: false }));
    }
    return results;
  });

  const changed = outcomes.filter((o) => o.outcome === "updated");
  const updated = changed.length;

  // Post-commit notifications. Only contact reassignment produces them — the
  // same rule `updateClient` applies — so a bulk STATUS change, which is the
  // common case, sends nothing.
  for (const outcome of changed) {
    if (outcome.outcome !== "updated") continue;
    const contacts: Array<["1st" | "2nd", string | undefined]> = [
      ["1st", patch.firstContactPerson],
      ["2nd", patch.secondContactPerson],
    ];
    for (const [role, person] of contacts) {
      if (!person) continue;
      await createNotification({
        recipient: person,
        type: `ASSIGNED:${role}`,
        message: `You were assigned “${outcome.client.name}”`,
        clientId: outcome.client.id,
        clientName: outcome.client.name,
      });
    }
  }

  // "not_found" AND "no_changes" both mean this client did not move, for
  // different reasons: one is gone, the other was already on that status.
  return { updated, skipped: unique.length - updated };
}

export async function deleteClient(id: string): Promise<boolean> {
  try {
    await prisma.client.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

/* ── Marketing metrics ───────────────────────────────────────────────────── */

export type MarketingMetricRow = MarketingMetric;

const dateOnly = (value: Date | string): string =>
  typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);

/**
 * UTC midnight — correct for `@db.Date` columns, which Prisma stores as UTC.
 */
const startOfDay = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

type MetricDb = Prisma.MarketingMetricGetPayload<Record<string, never>>;

function toMetricRow(row: MetricDb): MarketingMetricRow {
  return {
    id: row.id,
    name: row.name ?? "",
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    channel: row.channel,
    spend: Number(row.spend ?? 0),
    reach: Number(row.reach ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    notes: row.notes ?? "",
    createdAt: iso(row.createdAt) ?? "",
    updatedAt: iso(row.updatedAt) ?? "",
  };
}

export type MetricFilters = { channels?: string[]; from?: string; to?: string };

export async function listMetrics(filters: MetricFilters = {}): Promise<MarketingMetricRow[]> {
  const where: Prisma.MarketingMetricWhereInput = {};
  if (filters.channels && filters.channels.length > 0) where.channel = { in: filters.channels };
  // Overlap test: a period [startDate, endDate] intersects [from, to].
  if (filters.from) where.endDate = { gte: startOfDay(filters.from) };
  if (filters.to) where.startDate = { lte: startOfDay(filters.to) };

  const rows = await prisma.marketingMetric.findMany({
    where,
    orderBy: [{ startDate: "desc" }, { channel: "asc" }],
  });
  return rows.map(toMetricRow);
}

export type NewMetricInput = {
  id?: string;
  name?: string;
  startDate: string;
  endDate: string;
  channel: string;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  notes?: string;
};

export async function createMetric(input: NewMetricInput): Promise<MarketingMetricRow> {
  const row = await prisma.marketingMetric.create({
    data: {
      id: input.id ?? `m-${Date.now()}`,
      name: input.name ?? null,
      startDate: startOfDay(input.startDate),
      endDate: startOfDay(input.endDate),
      channel: input.channel,
      spend: input.spend,
      reach: input.reach,
      impressions: input.impressions,
      clicks: input.clicks,
      notes: input.notes ? input.notes : null,
    },
  });
  return toMetricRow(row);
}

export async function updateMetric(
  id: string,
  patch: Partial<NewMetricInput>,
): Promise<MarketingMetricRow | null> {
  const data: Prisma.MarketingMetricUpdateInput = {};
  if (patch.channel !== undefined) data.channel = patch.channel;
  if (patch.spend !== undefined) data.spend = patch.spend;
  if (patch.reach !== undefined) data.reach = patch.reach;
  if (patch.impressions !== undefined) data.impressions = patch.impressions;
  if (patch.clicks !== undefined) data.clicks = patch.clicks;
  if (patch.notes !== undefined) data.notes = patch.notes ? patch.notes : null;
  if (patch.startDate !== undefined) data.startDate = startOfDay(patch.startDate);
  if (patch.endDate !== undefined) data.endDate = startOfDay(patch.endDate);

  try {
    const row = await prisma.marketingMetric.update({ where: { id }, data });
    return toMetricRow(row);
  } catch {
    return null;
  }
}

export async function deleteMetric(id: string): Promise<boolean> {
  try {
    await prisma.marketingMetric.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes a batch of metrics in ONE statement.
 *
 * "Delete selected" on the entries table used to be the only alternative to
 * issuing one DELETE per row — a 25-row page would have meant 25 round trips and
 * 25 chances to fail halfway. Returns how many rows actually went, so a selection
 * containing an id someone else already removed reports honestly instead of
 * looking like a total failure.
 *
 * Unlike `deleteMetric`, errors propagate: a silent `false` here would tell the
 * caller "0 deleted" without saying why.
 */
export async function deleteMetrics(ids: string[]): Promise<number> {
  const clean = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (clean.length === 0) return 0;
  const { count } = await prisma.marketingMetric.deleteMany({ where: { id: { in: clean } } });
  return count;
}

/* ── Notifications ──────────────────────────────────────────────────────── */

export type NotificationRecord = {
  id: string;
  recipient: string;
  type: string;
  message: string;
  clientId?: string;
  clientName?: string;
  read: boolean;
  createdAt: string;
};

const MAX_NOTIFICATIONS = 300;

/** Same recipient-matching rule the app has always used (name / prefix based). */
export function notificationMatches(recipient: string, userName: string): boolean {
  const r = String(recipient ?? "").trim().toLowerCase();
  const u = String(userName ?? "").trim().toLowerCase();
  if (!r || !u) return false;
  return u === r || u.startsWith(r) || r.startsWith(u.split(" ")[0]);
}

export async function createNotification(input: {
  recipient: string;
  type: string;
  message: string;
  clientId?: string;
  clientName?: string;
}): Promise<void> {
  if (!input.recipient) return;
  await prisma.notification.create({
    data: {
      recipient: input.recipient,
      type: input.type,
      message: input.message,
      clientId: input.clientId ?? null,
      clientName: input.clientName ?? null,
    },
  });

  const overflow = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    skip: MAX_NOTIFICATIONS,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
  }
}

export async function listNotificationsFor(userName: string): Promise<NotificationRecord[]> {
  const rows = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  return rows
    .filter((row) => notificationMatches(row.recipient, userName))
    .map((row) => ({
      id: row.id,
      recipient: row.recipient,
      type: row.type,
      message: row.message,
      clientId: row.clientId ?? undefined,
      clientName: row.clientName ?? undefined,
      read: row.read,
      createdAt: iso(row.createdAt) ?? "",
    }));
}

export async function markNotificationsRead(userName: string, id?: string): Promise<void> {
  const mine = await listNotificationsFor(userName);
  const ids = id ? mine.filter((n) => n.id === id).map((n) => n.id) : mine.map((n) => n.id);
  if (ids.length === 0) return;
  await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { read: true } });
}

export async function deleteNotifications(
  userName: string,
  opts: { id?: string; clearRead?: boolean },
): Promise<void> {
  const mine = await listNotificationsFor(userName);
  if (opts.clearRead) {
    const ids = mine.filter((n) => n.read).map((n) => n.id);
    if (ids.length > 0) await prisma.notification.deleteMany({ where: { id: { in: ids } } });
    return;
  }
  if (opts.id && mine.some((n) => n.id === opts.id)) {
    await prisma.notification.deleteMany({ where: { id: opts.id } });
  }
}

/* ── Users ──────────────────────────────────────────────────────────────── */

export type UserRecord = {
  username: string;
  name: string;
  email?: string;
  role: string;
  hash: string;
  language: string;
  /**
   * Saved clients-table layout. Sparse — see resolveColumns(), which fills the
   * gaps from the registry defaults.
   */
  clientColumns: ColumnPrefs;
  /** Saved marketing-table layout. Same sparse shape as `clientColumns`. */
  marketingColumns: ColumnPrefs;
  /** Saved users-table layout. Same sparse shape again — one blob per table. */
  userColumns: ColumnPrefs;
  /** Downscaled PNG data URL, or undefined when no photo is set. */
  avatar?: string;
  phone?: string;
  jobTitle?: string;
  notes?: string;
  /** ISO string. Undefined on the raw-SQL fallbacks, which do not select it. */
  createdAt?: string;
};

type UserDb = Prisma.AppUserGetPayload<Record<string, never>> & {
  language?: unknown;
  clientColumns?: unknown;
  marketingColumns?: unknown;
  userColumns?: unknown;
};

/**
 * Which sanitizer each stored blob is read through.
 *
 * Every layout is sanitized against ITS OWN registry. `spend` is a marketing
 * column and `role` is a users column — neither is known to the clients
 * registry, so reading them with the clients rules would silently drop those
 * widths the moment the row was read back.
 */
const PREF_SANITIZERS: Record<LayoutField, (input: unknown) => ColumnPrefs> = {
  clientColumns: sanitizePrefs,
  marketingColumns: sanitizeMarketingPrefs,
  userColumns: sanitizeUserPrefs,
};

/** Reads the stored JSON layout, tolerating NULL and any junk shape. */
const toColumnPrefs = (raw: unknown, field: LayoutField): ColumnPrefs => {
  if (!raw || typeof raw !== "object") return {};
  return PREF_SANITIZERS[field](raw);
};

const toUserRecord = (row: UserDb): UserRecord => ({
  username: row.username,
  name: row.name,
  email: row.email ?? undefined,
  role: row.role,
  hash: row.hash,
  avatar: row.avatar ?? undefined,
  phone: row.phone ?? undefined,
  jobTitle: row.jobTitle ?? undefined,
  notes: row.notes ?? undefined,
  createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : undefined,
  language: typeof row.language === "string" && row.language === "en" ? "en" : "ar",
  clientColumns: toColumnPrefs(row.clientColumns, "clientColumns"),
  marketingColumns: toColumnPrefs(row.marketingColumns, "marketingColumns"),
  userColumns: toColumnPrefs(row.userColumns, "userColumns"),
});

function isMissingLanguageColumn(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /column .*"?language"? does not exist|Unknown column 'language'|no such column: language/i.test(msg);
}

/**
 * True only for Prisma's "the row I was told to update does not exist".
 *
 * This is the distinction `updateUser` turns on. It used to answer `null` for
 * EVERY failure, which made a genuine write error indistinguishable from a missing
 * user — and every caller reads `null` as "nothing to report". That is how a
 * photo upload came back `{ ok: true, avatar: null }`: the write threw
 * `Unknown argument 'avatar'`, the throw was swallowed here, and the route
 * reported success having stored nothing. Anything that is not P2025 is now
 * rethrown so the caller can answer 500 instead.
 */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2025"
  );
}

async function ensureLanguageColumn(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AppUser" ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'ar'`,
    );
  } catch {
    // Best-effort: databases without DDL permission keep working via fallbacks.
  }
}

export async function listUsers(): Promise<UserRecord[]> {
  try {
    const rows = await prisma.appUser.findMany({ orderBy: { username: "asc" } });
    return rows.map(toUserRecord);
  } catch (error) {
    if (!isMissingLanguageColumn(error)) throw error;
    const rows = await prisma.$queryRawUnsafe<UserDb[]>(
      `SELECT "username", "name", "email", "role", "hash" FROM "AppUser" ORDER BY "username" ASC`,
    );
    return rows.map(toUserRecord);
  }
}

export async function findUser(username: string): Promise<UserRecord | null> {
  try {
    const row = await prisma.appUser.findUnique({
      where: { username: String(username ?? "").toLowerCase() },
    });
    return row ? toUserRecord(row) : null;
  } catch (error) {
    if (!isMissingLanguageColumn(error)) throw error;
    const rows = await prisma.$queryRawUnsafe<UserDb[]>(
      `SELECT "username", "name", "email", "role", "hash" FROM "AppUser" WHERE "username" = $1 LIMIT 1`,
      String(username ?? "").toLowerCase(),
    );
    return rows.length > 0 ? toUserRecord(rows[0]) : null;
  }
}

export async function countUsers(): Promise<number> {
  return prisma.appUser.count();
}

export async function createUser(
  input: Omit<UserRecord, "language" | "clientColumns" | "marketingColumns" | "userColumns" | "createdAt"> & { language?: string; clientColumns?: ColumnPrefs },
): Promise<UserRecord> {
  try {
    const row = await prisma.appUser.create({
      data: {
        username: input.username.toLowerCase(),
        name: input.name,
        email: input.email ?? null,
        role: input.role,
        hash: input.hash,
        language: input.language ?? "ar",
        avatar: input.avatar ?? null,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        notes: input.notes ?? null,
        clientColumns: (input.clientColumns ?? {}) as Prisma.InputJsonValue,
      },
    });
    return toUserRecord(row);
  } catch (error) {
    if (!isMissingLanguageColumn(error)) throw error;
    await ensureLanguageColumn();
    const row = await prisma.appUser.create({
      data: {
        username: input.username.toLowerCase(),
        name: input.name,
        email: input.email ?? null,
        role: input.role,
        hash: input.hash,
        language: input.language ?? "ar",
        avatar: input.avatar ?? null,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        notes: input.notes ?? null,
        clientColumns: (input.clientColumns ?? {}) as Prisma.InputJsonValue,
      },
    });
    return toUserRecord(row);
  }
}

/**
 * Which saved-layout blob to write.
 *
 * The clients and marketing tables have unrelated column sets, so they keep
 * separate columns. Taking the field as a union rather than hard-coding
 * `clientColumns` is what lets one function serve both without the caller being
 * able to name an arbitrary column.
 */
export type LayoutField = "clientColumns" | "marketingColumns" | "userColumns";

export async function saveUserColumnPrefs(
  username: string,
  field: LayoutField,
  prefs: unknown,
): Promise<ColumnPrefs> {
  // Sanitize before persisting: unknown keys are dropped and widths clamped to
  // the registry, so a hand-crafted payload cannot store junk the UI would then
  // have to defend against on every render. Which registry depends on the field —
  // see toColumnPrefs above for why they cannot share one.
  const clean = PREF_SANITIZERS[field](prefs);
  await prisma.appUser.update({
    where: { username: username.toLowerCase() },
    // Computed rather than `data: { [field]: clean }` only so the key stays
    // typed against the union above — a typo becomes a compile error, not a
    // runtime "unknown argument".
    data: { [field]: clean as Prisma.InputJsonValue },
  });
  return clean;
}

export async function updateUser(
  username: string,
  patch: {
    newUsername?: string; name?: string; email?: string; role?: string; language?: string;
    avatar?: string | null; phone?: string | null; jobTitle?: string | null; notes?: string | null;
  },
): Promise<UserRecord | null> {
  const data: Prisma.AppUserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.language !== undefined) data.language = patch.language;
  // `null` clears a field; `undefined` means "not part of this patch". The
  // distinction is what lets the profile form blank one field without having to
  // resend the whole row.
  if (patch.avatar !== undefined) data.avatar = patch.avatar;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.jobTitle !== undefined) data.jobTitle = patch.jobTitle;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.newUsername !== undefined) data.username = patch.newUsername.toLowerCase();

  // Language-only updates (from the header switch) must not fail on databases
  // that have not run the language-column migration yet.
  if (patch.language !== undefined && patch.name === undefined && patch.email === undefined && patch.role === undefined && patch.newUsername === undefined) {
    try {
      const row = await prisma.appUser.update({
        where: { username: username.toLowerCase() },
        data,
      });
      return toUserRecord(row);
    } catch (error) {
      // A missing row is a real answer; anything else is a failure the caller
      // must see rather than have read as "saved".
      if (isRecordNotFound(error)) return null;
      if (!isMissingLanguageColumn(error)) throw error;
      return findUser(username);
    }
  }

  try {
    const row = await prisma.appUser.update({
      where: { username: username.toLowerCase() },
      data,
    });
    return toUserRecord(row);
  } catch (error) {
    if (isMissingLanguageColumn(error) && patch.language !== undefined) {
      await ensureLanguageColumn();
      try {
        const row = await prisma.appUser.update({
          where: { username: username.toLowerCase() },
          data,
        });
        return toUserRecord(row);
      } catch (retryError) {
        if (isRecordNotFound(retryError)) return null;
        throw retryError;
      }
    }
    // Every other failure — an unknown column, a constraint, a dead connection —
    // used to become a bare `null`, which each caller reported to the browser as
    // success. Rethrown so the route can answer 500 and the UI can say so.
    if (isRecordNotFound(error)) return null;
    throw error;
  }
}

export async function deleteUser(username: string): Promise<void> {
  await prisma.appUser.deleteMany({ where: { username: username.toLowerCase() } });
}


