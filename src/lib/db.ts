import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { type ActivityEntry, type ClientData, type MarketingMetric, makeActivityEntry } from "./types";
import { normalizeStatus } from "./reporting";
import { identityKey } from "./import-clients";

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

export type SettingKey = "channels" | "statuses" | "locations" | "logo";

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
  channel?: string;
  status?: string;
  location?: string;
  /**
   * Restrict to clients whose FIRST contact matches. Composes with
   * `secondContact` as AND, so `first=A&second=B` narrows to the pairing rather
   * than the union.
   */
  firstContact?: string;
  /** Restrict to clients whose SECOND contact matches. See `firstContact`. */
  secondContact?: string;
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
};

export function clientWhere(filters: ClientFilters): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = {};
  if (filters.channel) where.acquisitionChannel = filters.channel;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.location) where.location = { contains: filters.location, mode: "insensitive" };
  // 1st and 2nd contact are separate filters that AND together, so selecting a
  // 1st and a 2nd contact narrows to clients held by that exact pairing. The
  // UI dropdowns pass whole names, so this uses `equals` rather than the
  // `contains` a free-typed search would need.
  if (filters.firstContact) {
    where.firstContactPerson = { equals: filters.firstContact, mode: "insensitive" };
  }
  if (filters.secondContact) {
    where.secondContactPerson = { equals: filters.secondContact, mode: "insensitive" };
  }
  if (filters.assignee) {
    // AND, not OR: this has to compose with an explicit salesperson filter
    // rather than overwrite it.
    where.AND = [
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
  return where;
}

export async function listClients(filters: ClientFilters = {}): Promise<ClientRow[]> {
  const rows = await prisma.client.findMany({
    where: clientWhere(filters),
    orderBy: { lastUpdateDate: "desc" },
  });
  return rows.map(toClientRow);
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
 * Identity keys for every stored client, so a re-run of the import is a no-op
 * instead of duplicating the sheet.
 *
 * Uses the SAME `identityKey` the planner uses, which matters for the rows whose
 * phone column holds prose instead of a number: keying on the phone alone
 * returns nothing for those, and they were re-imported on every single run.
 */
export async function existingClientKeys(): Promise<string[]> {
  const rows = await prisma.client.findMany({
    select: { phoneNumber: true, name: true, project: true },
  });
  return rows
    .map((r) => identityKey({ phone: r.phoneNumber, name: r.name, project: r.project }))
    .filter(Boolean);
}

export type ClientPatch = Partial<NewClientInput> & { archived?: boolean };

export type UpdateClientResult =
  | { outcome: "updated"; client: ClientRow }
  | { outcome: "not_found" }
  | { outcome: "no_changes" };

export async function updateClient(
  id: string,
  patch: ClientPatch,
  actor: string,
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
};

type UserDb = Prisma.AppUserGetPayload<Record<string, never>> & { language?: unknown };

const toUserRecord = (row: UserDb): UserRecord => ({
  username: row.username,
  name: row.name,
  email: row.email ?? undefined,
  role: row.role,
  hash: row.hash,
  language: typeof row.language === "string" && row.language === "en" ? "en" : "ar",
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
  input: Omit<UserRecord, "language"> & { language?: string },
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
      },
    });
    return toUserRecord(row);
  }
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


