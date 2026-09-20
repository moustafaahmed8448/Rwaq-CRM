import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { type ActivityEntry, type ClientData, type MarketingMetric, makeActivityEntry } from "./types";

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
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a PostgreSQL database, then run `npx prisma db push` and `npx prisma db seed`.",
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

export type SettingKey = "channels" | "statuses" | "locations";

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
    status: row.status,
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
  salesperson?: string;
  archived?: boolean;
  includeArchived?: boolean;
};

export function clientWhere(filters: ClientFilters): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = {};
  if (filters.channel) where.acquisitionChannel = filters.channel;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.location) where.location = { contains: filters.location, mode: "insensitive" };
  if (filters.salesperson) {
    where.OR = [
      { firstContactPerson: { contains: filters.salesperson, mode: "insensitive" } },
      { secondContactPerson: { contains: filters.salesperson, mode: "insensitive" } },
    ];
  }
  if (filters.archived) where.archived = true;
  else if (!filters.includeArchived) where.archived = false;
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

export async function createClient(input: NewClientInput, actor: string): Promise<ClientRow> {
  const log: ActivityEntry[] = [makeActivityEntry("CREATED", actor, { summary: "Client created" })];
  const row = await prisma.client.create({
    data: {
      ...input,
      notes: input.notes ?? null,
      activityLog: log as unknown as Prisma.InputJsonValue,
    },
  });

  // Notify anyone newly assigned as a contact person.
  for (const person of [input.firstContactPerson, input.secondContactPerson]) {
    if (person) {
      await createNotification({
        recipient: person,
        type: "ASSIGNED",
        message: `You were assigned \u201c${input.name}\u201d`,
        clientId: row.id,
        clientName: input.name,
      });
    }
  }

  return toClientRow(row);
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  phoneNumber: "Phone",
  project: "Project",
  location: "Location",
  status: "Status",
  acquisitionChannel: "Channel",
  operationToTake: "Operation",
  firstContactPerson: "1st Contact",
  secondContactPerson: "2nd Contact",
  notes: "Notes",
};

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
  const notify: Array<{ field: string; newVal: string }> = [];

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    const oldValue = (existing as unknown as Record<string, unknown>)[key];
    if (String(oldValue ?? "") === String(value ?? "")) continue;
    (updates as Record<string, unknown>)[key] = value;
    const label = FIELD_LABELS[key] ?? key;
    changes.push({ field: label, oldVal: String(oldValue ?? ""), newVal: String(value) });
    if (key === "firstContactPerson" || key === "secondContactPerson") {
      notify.push({ field: label, newVal: String(value) });
    }
  }

  const archiveChanged = archived !== undefined && archived !== Boolean(existing.archived);
  if (changes.length === 0 && !archiveChanged) return { outcome: "no_changes" };

  const extraActivity: ActivityEntry[] = [];
  if (archiveChanged) {
    updates.archived = archived;
    updates.archivedAt = archived ? new Date() : null;
    extraActivity.push(
      makeActivityEntry(archived ? "ARCHIVED" : "RESTORED", actor, {
        summary: archived
          ? `Client \u201c${existing.name}\u201d archived`
          : `Client \u201c${existing.name}\u201d restored from archive`,
      }),
    );
  }

  const previousLog = Array.isArray(existing.activityLog)
    ? (existing.activityLog as unknown as ActivityEntry[])
    : [];

  const nextLog: ActivityEntry[] = [
    ...previousLog,
    ...extraActivity,
    ...changes.map((c) =>
      makeActivityEntry(c.field === "Status" ? "STATUS_CHANGE" : "FIELD_EDIT", actor, {
        field: c.field,
        oldValue: c.oldVal,
        newValue: c.newVal,
        summary:
          c.field === "Status"
            ? `Status changed: ${c.oldVal} \u2192 ${c.newVal}`
            : `${c.field} updated`,
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
      type: "ASSIGNED",
      message: `You were assigned \u201c${existing.name}\u201d as ${item.field.toLowerCase()}`,
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

const startOfDay = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

type MetricDb = Prisma.MarketingMetricGetPayload<Record<string, never>>;

function toMetricRow(row: MetricDb): MarketingMetricRow {
  return {
    id: row.id,
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
};

type UserDb = Prisma.AppUserGetPayload<Record<string, never>>;

const toUserRecord = (row: UserDb): UserRecord => ({
  username: row.username,
  name: row.name,
  email: row.email ?? undefined,
  role: row.role,
  hash: row.hash,
});

export async function listUsers(): Promise<UserRecord[]> {
  const rows = await prisma.appUser.findMany({ orderBy: { username: "asc" } });
  return rows.map(toUserRecord);
}

export async function findUser(username: string): Promise<UserRecord | null> {
  const row = await prisma.appUser.findUnique({
    where: { username: String(username ?? "").toLowerCase() },
  });
  return row ? toUserRecord(row) : null;
}

export async function countUsers(): Promise<number> {
  return prisma.appUser.count();
}

export async function createUser(input: UserRecord): Promise<UserRecord> {
  const row = await prisma.appUser.create({
    data: {
      username: input.username.toLowerCase(),
      name: input.name,
      email: input.email ?? null,
      role: input.role,
      hash: input.hash,
    },
  });
  return toUserRecord(row);
}

export async function updateUser(
  username: string,
  patch: { newUsername?: string; name?: string; email?: string; role?: string },
): Promise<UserRecord | null> {
  const data: Prisma.AppUserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.newUsername !== undefined) data.username = patch.newUsername.toLowerCase();

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

export async function deleteUser(username: string): Promise<void> {
  await prisma.appUser.deleteMany({ where: { username: username.toLowerCase() } });
}


