import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { type ActivityEntry, type ClientData, type MarketingMetric, makeActivityEntry } from "./types";
import { normalizeStatus } from "./reporting";
import { identityKey, type BaselineClient } from "./import-clients";
import { sanitizePrefs, type ColumnPrefs } from "./client-columns";

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

export type SettingKey = "channels" | "statuses" | "locations" | "logo" | "optionColors";

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
    archived: Boolean(row.archived),
    archivedAt: iso(row.archivedAt),
    activityLog: Array.isArray(row.activityLog)
      ? (row.activityLog as unknown as ActivityEntry[])
      : [],
  };
}

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
    // Local midnight, not UTC: Client.createdAt is a timestamp, so "the 1st"
    // should mean the user's own 1st, not 00:00 UTC on the 1st.
    where.createdAt = {
      ...(filters.createdFrom ? { gte: startOfLocalDay(filters.createdFrom) } : {}),
      ...(filters.createdTo ? { lt: startOfLocalDay(filters.createdTo) } : {}),
    };
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
};

export async function updateClient(
  id: string,
  patch: ClientPatch,
  actor: string,
  options: UpdateClientOptions = {},
): Promise<UpdateClientResult> {
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return { outcome: "not_found" };

  const { archived, ...rest } = patch;
  const updates: Prisma.ClientUpdateInput = {};
  const changes: Array<{ field: string; oldVal: string; newVal: string }> = [];
  const notify: Array<{ contact: "1st" | "2nd"; newVal: string }> = [];

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    const oldValue = (existing as unknown as Record<string, unknown>)[key];
    if (String(oldValue ?? "") === String(value ?? "")) continue;
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

  const row = await prisma.client.update({
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

/** UTC midnight — correct for `@db.Date` columns, which Prisma stores as UTC. */
const startOfDay = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

/**
 * Local midnight — correct for timestamp columns such as Client.createdAt, so a
 * date the user picked means that day in their own timezone.
 */
const startOfLocalDay = (value: string): Date => {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
};

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
};

type UserDb = Prisma.AppUserGetPayload<Record<string, never>> & {
  language?: unknown;
  clientColumns?: unknown;
};

/** Reads the stored JSON layout, tolerating NULL and any junk shape. */
const toColumnPrefs = (raw: unknown): ColumnPrefs => {
  if (!raw || typeof raw !== "object") return {};
  return sanitizePrefs(raw);
};

const toUserRecord = (row: UserDb): UserRecord => ({
  username: row.username,
  name: row.name,
  email: row.email ?? undefined,
  role: row.role,
  hash: row.hash,
  language: typeof row.language === "string" && row.language === "en" ? "en" : "ar",
  clientColumns: toColumnPrefs(row.clientColumns),
});

function isMissingLanguageColumn(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /column .*"?language"? does not exist|Unknown column 'language'|no such column: language/i.test(msg);
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
  input: Omit<UserRecord, "language" | "clientColumns"> & { language?: string; clientColumns?: ColumnPrefs },
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
        clientColumns: (input.clientColumns ?? {}) as Prisma.InputJsonValue,
      },
    });
    return toUserRecord(row);
  }
}

export async function saveUserColumnPrefs(
  username: string,
  prefs: unknown,
): Promise<ColumnPrefs> {
  // Sanitize before persisting: unknown keys are dropped and widths clamped to
  // the registry, so a hand-crafted payload cannot store junk the UI would then
  // have to defend against on every render.
  const clean = sanitizePrefs(prefs);
  await prisma.appUser.update({
    where: { username: username.toLowerCase() },
    data: { clientColumns: clean as Prisma.InputJsonValue },
  });
  return clean;
}

export async function updateUser(
  username: string,
  patch: { newUsername?: string; name?: string; email?: string; role?: string; language?: string },
): Promise<UserRecord | null> {
  const data: Prisma.AppUserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.language !== undefined) data.language = patch.language;
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
      if (!isMissingLanguageColumn(error)) return null;
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
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function deleteUser(username: string): Promise<void> {
  await prisma.appUser.deleteMany({ where: { username: username.toLowerCase() } });
}


