import { BUILTIN_LOCATION_KEYS, PREDEFINED_STATUSES, channelValues, parseChannel } from "./reporting";
import type { SheetRow } from "./google-sheet";

/**
 * Turns sheet rows into an import plan.
 *
 * This module is pure: it reads the sheet and the currently-saved reference
 * values, and returns what WOULD happen. Nothing is written here, so the same
 * function backs both the preview and the commit — the preview cannot drift
 * from the write.
 */

/**
 * Arabic sheet status -> stored Client.status.
 *
 * Only statuses with an unambiguous counterpart in PIPELINE_STAGES are mapped.
 * The two terminal ones matter most: `تم التعاقد` (contracted) and
 * `خسارة نهائية` (final loss) are the WON and LOST outcomes that drive the
 * dashboard KPI cards, the funnel and the win-rate. Imported as custom statuses
 * they would be invisible to `isWon`/`isLost` and every report would read zero.
 *
 * `غير مناسب` (not a fit) and `مطلوب تواصل` (contact needed) have no
 * counterpart and deliberately fall through to become custom statuses.
 */
const STATUS_MAP: Record<string, string> = {
  "تم التعاقد": "WON",
  "خسارة نهائية": "LOST",
  "غير متفاعل": "NO_RESPONSE",
  "تم التواصل": "CONTACTED",
  "جاد": "QUALIFIED",
};

/**
 * Digits-only identity key for a phone, used for duplicate detection.
 *
 * The sheet is inconsistent: `+966565971004`, `0567661918` and `555221544` are
 * the same number written three ways, and some cells hold prose instead
 * ("عن طريق المبيعات"). Normalizing to the last 9 digits collapses the
 * formatting variants, and a number with no digits at all yields "" so it can
 * never be mistaken for a match.
 */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) return "";
  return digits.slice(-9);
}

/**
 * Formats a phone for storage.
 *
 * The sheet has typos like `:966547774023` (a colon where the plus sign belongs)
 * and doubled entries (`582644016 // 966543885227`). A leading `:` is repaired
 * because it is unambiguously a mistyped `+`. Anything that does not look like a
 * number is left exactly as written — the row still has to reach the CRM, and
 * discarding a lead because its phone column held a note would be worse than
 * storing the note.
 */
export function tidyPhone(phone: string): string {
  const trimmed = phone.trim();
  if (/^:\s*\d/.test(trimmed)) return `+${trimmed.slice(1).trim()}`;
  return trimmed;
}

/** Collapses the incidental whitespace and letter variants in a name. */
const foldName = (name: string): string =>
  name
    .replace(/[ً-ٟٓ-٭]/g, "") // harakat / tatweel
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/[ؤئ]/g, "ء") // ؤ ئ -> ء
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Identity key used to decide whether a sheet row is already in the CRM.
 *
 * The phone is the primary key, but 31 of the 344 rows have prose in the phone
 * column instead of a number ("عن طريق المبيعات", "منصة فرصة"). Those yield no
 * phone key, and keying on nothing meant they were re-imported on EVERY run —
 * the first import left 337 rows, the second added 28 more.
 *
 * So those rows fall back to name + project. Among the 31 affected rows all 31
 * names are distinct, and folding the Arabic letter variants (أ/ا, ى/ي, ة/ه)
 * stops a cosmetic spelling difference from reading as a different person. The
 * project is folded in too because names alone are NOT unique in this sheet —
 * "عبدالله" appears 3 times, "فهد" 3 times — and those repeats are genuinely
 * different leads, which is exactly why a phone is preferred whenever one exists.
 */
export function identityKey(input: { phone: string; name: string; project: string }): string {
  const phone = phoneKey(input.phone);
  if (phone) return `p:${phone}`;
  const name = foldName(input.name);
  if (!name) return "";
  return `n:${name}|${foldName(input.project).slice(0, 40)}`;
}

export interface ImportClientDraft {
  /** Sheet row, so a bad record can be traced back. */
  rowNumber: number;
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  createdAt: Date;
  /** True when the sheet had no تاريخ التسجيل and we fell back to "now". */
  dateAssumed: boolean;
}

/** `already_in_db` is gone: a row that matches a stored client is now reported as
 *  a `changed` or `identical` diff row, not as a skip. */
export type SkipReason = "no_name" | "no_phone" | "duplicate_in_sheet";

export interface SkippedRow {
  rowNumber: number;
  name: string;
  phone: string;
  reason: SkipReason;
}

export interface ImportPlan {
  drafts: ImportClientDraft[];
  skipped: SkippedRow[];
  /** Reference values that do not exist yet and will be created. */
  newStatuses: string[];
  newChannels: string[];
  newLocations: string[];
  /** Sheet status -> stored status, for the preview table. */
  statusMapping: Array<{ from: string; to: string; count: number }>;
  /** Rows whose sheet value had damaged characters removed. */
  repairedRows: Array<{ rowNumber: number; fields: string[] }>;
  /** Every sheet row, classified. Drives the per-row import UI. */
  diff: DiffRow[];
  /**
   * CRM clients with no counterpart row in the sheet. Read-only: absence from a
   * spreadsheet is not evidence a client should be removed, so nothing here can
   * be actioned from the import screen.
   */
  dbOnly: BaselineClient[];
}

/**
 * Fields the sheet is allowed to write.
 *
 * `createdAt` is deliberately excluded: it is the database's record of when the
 * row landed, and the first import already took the sheet's registration date.
 * Re-syncing it would rewrite history on every run. `archived` and `notes` are
 * excluded because the sheet carries neither — an import must never un-archive a
 * client or clobber a note someone typed in the app.
 */
export const SYNCABLE_FIELDS = [
  "name",
  "phoneNumber",
  "status",
  "project",
  "location",
  "acquisitionChannel",
  "operationToTake",
  "firstContactPerson",
  "secondContactPerson",
] as const;

export type SyncableField = (typeof SYNCABLE_FIELDS)[number];

export const isSyncableField = (value: string): value is SyncableField =>
  (SYNCABLE_FIELDS as readonly string[]).includes(value);

/** A client as the importer needs to see it, to diff against a sheet row. */
export interface BaselineClient {
  id: string;
  name: string;
  phoneNumber: string;
  /** Already run through normalizeStatus, so it compares against a mapped value. */
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  archived: boolean;
}

/**
 * YYYY-MM-DD in UTC. Both sides of a date comparison use this, so a timezone
 * offset can never make two equal calendar dates read as different.
 */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type DiffKind = "new" | "changed" | "identical" | "skipped" | "db_only";

/** One field where the sheet and the CRM disagree. */
export interface FieldChange {
  field: SyncableField;
  /** Current value in the CRM. */
  db: string;
  /** Value the sheet would write. */
  sheet: string;
}

export interface DiffRow {
  kind: DiffKind;
  /** 1-based sheet row. Null for db_only, which has no source row. */
  rowNumber: number | null;
  /** The matched CRM client. Null for new and skipped. */
  clientId: string | null;
  name: string;
  phone: string;
  status: string;
  channel: string;
  location: string;
  /** Why this row was skipped. */
  reason?: SkipReason;
  /** Fields the sheet and the CRM disagree on. Empty unless kind is "changed". */
  changes: FieldChange[];
  /** The matched client is archived, so an update would not surface in the list. */
  archived: boolean;
}

/** One row the user chose to act on, and the fields they kept from the CRM. */
export interface RowSelection {
  rowNumber: number;
  /** Fields to leave at their current CRM value. */
  keep?: string[];
}

export interface ResolvedSelection {
  creates: ImportClientDraft[];
  updates: Array<{ clientId: string; patch: Record<string, string>; archived: boolean }>;
  newStatuses: string[];
  newChannels: string[];
  newLocations: string[];
}

/** The values a row would be written with, after status/channel normalisation. */
function draftFromRow(row: SheetRow, now: Date): ImportClientDraft {
  return {
    rowNumber: row.rowNumber,
    name: row.name,
    phoneNumber: tidyPhone(row.phone),
    status: STATUS_MAP[row.status] ?? row.status,
    project: row.project,
    location: row.location,
    acquisitionChannel: resolveChannel(row.channel),
    operationToTake: row.operation,
    firstContactPerson: row.firstContact,
    secondContactPerson: row.secondContact,
    // 56 of the 344 rows have no تاريخ التسجيل. They are imported with the
    // import time and flagged, because dropping a real lead over a missing date
    // would lose the client entirely.
    createdAt: row.registeredAt ?? now,
    dateAssumed: !row.registeredAt,
  };
}

/** Every syncable field where the sheet and the stored client disagree. */
function diffFields(client: BaselineClient, draft: ImportClientDraft): FieldChange[] {
  const out: FieldChange[] = [];
  const cmp = (field: SyncableField, db: string, sheet: string): void => {
    const a = db ?? "";
    const b = sheet ?? "";
    if (a !== b) out.push({ field, db: a, sheet: b });
  };
  cmp("name", client.name, draft.name);
  cmp("phoneNumber", client.phoneNumber, draft.phoneNumber);
  cmp("status", client.status, draft.status);
  cmp("project", client.project, draft.project);
  cmp("location", client.location, draft.location);
  cmp("acquisitionChannel", client.acquisitionChannel, draft.acquisitionChannel);
  cmp("operationToTake", client.operationToTake, draft.operationToTake);
  cmp("firstContactPerson", client.firstContactPerson, draft.firstContactPerson);
  cmp("secondContactPerson", client.secondContactPerson, draft.secondContactPerson);
  return out;
}

/**
 * Applies the user's per-row choices to a plan.
 *
 * Pure, and deliberately separate from buildImportPlan: the plan describes what
 * the sheet says, this decides what we do about it. Only SELECTED rows
 * contribute reference values, so deselecting every row that mentions a channel
 * means that channel is never added to the shared list.
 */
export function applySelection(
  plan: ImportPlan,
  selection: RowSelection[],
  refs: { statuses: string[]; channels: string[]; locations: string[] },
): ResolvedSelection {
  const keepByRow = new Map<number, Set<string>>();
  for (const sel of selection) {
    if (!Number.isInteger(sel.rowNumber)) continue;
    // `keep` is filtered through the allowlist: the browser must not be able to
    // name a field outside the syncable set.
    keepByRow.set(sel.rowNumber, new Set((sel.keep ?? []).filter(isSyncableField)));
  }

  const creates: ImportClientDraft[] = [];
  const updates: ResolvedSelection["updates"] = [];
  const newStatuses: string[] = [];
  const newChannels: string[] = [];
  const newLocations: string[] = [];

  const knownStatuses = [...PREDEFINED_STATUSES, ...refs.statuses];
  const knownChannels = [...channelValues, ...refs.channels];
  const knownLocations = [...BUILTIN_LOCATION_KEYS, ...refs.locations];
  const addRef = (list: string[], knownList: string[], value: string): void => {
    if (!value || known(knownList, value) || known(list, value)) return;
    list.push(value);
    knownList.push(value);
  };

  for (const row of plan.diff) {
    if (row.rowNumber === null) continue;
    // A row absent from the selection is not actioned at all — this is what
    // makes an unselected "changed" row a skip.
    const keep = keepByRow.get(row.rowNumber);
    if (!keep) continue;

    if (row.kind === "new") {
      const draft = plan.drafts.find((d) => d.rowNumber === row.rowNumber);
      if (!draft) continue;
      creates.push(draft);
      addRef(newStatuses, knownStatuses, draft.status);
      addRef(newChannels, knownChannels, draft.acquisitionChannel);
      addRef(newLocations, knownLocations, draft.location);
      continue;
    }

    if (row.kind === "changed" && row.clientId) {
      const patch: Record<string, string> = {};
      for (const change of row.changes) {
        if (keep.has(change.field)) continue;
        patch[change.field] = change.sheet;
      }
      // Every differing field was kept, so there is nothing to write.
      if (Object.keys(patch).length === 0) continue;
      if (patch.status) addRef(newStatuses, knownStatuses, patch.status);
      if (patch.acquisitionChannel) addRef(newChannels, knownChannels, patch.acquisitionChannel);
      if (patch.location) addRef(newLocations, knownLocations, patch.location);
      updates.push({ clientId: row.clientId, patch, archived: row.archived });
    }
  }

  return { creates, updates, newStatuses, newChannels, newLocations };
}

/**
 * Reference values that already exist, so the plan only proposes genuinely new
 * ones. Built-ins come from the shared registries in reporting.ts; customs come
 * from the Setting rows the caller has already read.
 */
export interface KnownReferences {
  statuses: string[];
  channels: string[];
  locations: string[];
}

/** Case-insensitive membership test, matching addSettingValue in db.ts. */
function known(list: string[], value: string): boolean {
  return list.some((v) => v.toLowerCase() === value.toLowerCase());
}

/**
 * Resolves a sheet channel to a stored value.
 *
 * Runs through the app's own `parseChannel`, so `TikTok` -> `TIKTOK` and
 * `Whatsapp` -> `WHATSAPP` land on the existing built-ins, and `منصة فرصة`
 * normalizes to `منصة_فرصة` — which already exists in this workspace. Anything
 * else (`Website call`, `Email Info`, `المبيعات`, `الشركة`) is kept and
 * registered as a custom channel.
 */
function resolveChannel(raw: string): string {
  return parseChannel(raw) ?? raw;
}

/**
 * Builds the plan.
 *
 * `baseline` are the clients ALREADY in the database. A sheet row that matches
 * one is reported as a difference to review instead of being imported as a
 * duplicate, and a row that matches nothing is a new client.
 */
export function buildImportPlan(
  rows: SheetRow[],
  refs: KnownReferences,
  baseline: BaselineClient[] = [],
): ImportPlan {
  const now = new Date();
  // Seeded with the built-ins so one is never proposed as a new custom value.
  // That matters because a custom value lands in the `removable` list: adding
  // TIKTOK as a custom would make a built-in channel deletable, and once the last
  // client moved off it the channel would disappear from the picker entirely.
  // Sourced from the shared registries in reporting.ts, not a local copy, so a
  // new stage or channel is picked up here automatically.
  const knownStatuses = [...PREDEFINED_STATUSES, ...refs.statuses];
  const knownChannels = [...channelValues, ...refs.channels];
  const knownLocations = [...BUILTIN_LOCATION_KEYS, ...refs.locations];

  // Identity key -> the stored client. Archived clients are deliberately INCLUDED:
  // leaving them out would make a sheet row matching an archived client look new,
  // and the import would create a duplicate of a record someone deliberately
  // archived. They are flagged on the diff row instead.
  const dbByKey = new Map<string, BaselineClient>();
  for (const client of baseline) {
    const key = identityKey({ phone: client.phoneNumber, name: client.name, project: client.project });
    // First writer wins, so two clients collapsing to the same key cannot make the
    // result depend on the order the database returned them in.
    if (key && !dbByKey.has(key)) dbByKey.set(key, client);
  }
  const matchedIds = new Set<string>();

  const sheetKeys = new Set<string>();
  const diff: DiffRow[] = [];
  const drafts: ImportClientDraft[] = [];
  const skipped: SkippedRow[] = [];
  const newStatuses: string[] = [];
  const newChannels: string[] = [];
  const newLocations: string[] = [];
  const statusCounts = new Map<string, { from: string; to: string; count: number }>();
  const repairedRows: ImportPlan["repairedRows"] = [];

  const addRef = (list: string[], knownList: string[], value: string): void => {
    if (!value || known(knownList, value) || known(list, value)) return;
    list.push(value);
    knownList.push(value);
  };

  for (const row of rows) {
    if (row.repaired.length > 0) repairedRows.push({ rowNumber: row.rowNumber, fields: row.repaired });

    const draft = draftFromRow(row, now);

    const note = (kind: DiffKind, extra: Partial<DiffRow> = {}): void => {
      diff.push({
        kind,
        rowNumber: row.rowNumber,
        clientId: null,
        name: draft.name,
        phone: draft.phoneNumber,
        status: draft.status,
        channel: draft.acquisitionChannel,
        location: draft.location,
        changes: [],
        archived: false,
        ...extra,
      });
    };

    // A row with no name cannot be identified or searched for later, so it is
    // dropped rather than imported as an unlabelled record.
    if (!row.name) {
      skipped.push({ rowNumber: row.rowNumber, name: "", phone: row.phone, reason: "no_name" });
      note("skipped", { phone: row.phone, reason: "no_name" });
      continue;
    }

    // The phone is the only stable identity the sheet carries, and the CRM's
    // own create form requires one, so a row without it is held back.
    if (!row.phone) {
      skipped.push({ rowNumber: row.rowNumber, name: row.name, phone: "", reason: "no_phone" });
      note("skipped", { reason: "no_phone" });
      continue;
    }

    const mapped = statusCounts.get(row.status);
    if (mapped) mapped.count += 1;
    else statusCounts.set(row.status, { from: row.status, to: draft.status, count: 1 });

    // Phone is the primary identity; rows whose phone column holds prose fall
    // back to name+project (see identityKey) so a re-run cannot duplicate them.
    const key = identityKey({ phone: row.phone, name: row.name, project: row.project });

    if (key && sheetKeys.has(key)) {
      skipped.push({ rowNumber: row.rowNumber, name: row.name, phone: row.phone, reason: "duplicate_in_sheet" });
      note("skipped", { reason: "duplicate_in_sheet" });
      continue;
    }
    if (key) sheetKeys.add(key);

    const matched = key ? dbByKey.get(key) : undefined;

    if (matched) {
      matchedIds.add(matched.id);
      const changes = diffFields(matched, draft);
      // The preview lists reference values for every row that would write
      // something, not just the new ones: an update can introduce a status the
      // database has never seen, and under-warning here would surprise the user.
      for (const change of changes) {
        if (change.field === "status") addRef(newStatuses, knownStatuses, change.sheet);
        if (change.field === "acquisitionChannel") addRef(newChannels, knownChannels, change.sheet);
        if (change.field === "location") addRef(newLocations, knownLocations, change.sheet);
      }
      note(changes.length > 0 ? "changed" : "identical", {
        clientId: matched.id,
        changes,
        archived: matched.archived,
      });
      continue;
    }

    addRef(newStatuses, knownStatuses, draft.status);
    addRef(newChannels, knownChannels, draft.acquisitionChannel);
    addRef(newLocations, knownLocations, draft.location);

    drafts.push(draft);
    note("new");
  }

  // Anything the sheet never mentioned. Archived clients are left out: they are
  // expected to be absent from a lead sheet, and listing them would bury the
  // active ones under noise.
  const dbOnly = baseline.filter((c) => !matchedIds.has(c.id) && !c.archived);

  return {
    drafts,
    skipped,
    newStatuses,
    newChannels,
    newLocations,
    statusMapping: [...statusCounts.values()].sort((a, b) => b.count - a.count),
    repairedRows,
    diff,
    dbOnly,
  };
}

