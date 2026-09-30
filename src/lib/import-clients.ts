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

export type SkipReason = "no_name" | "no_phone" | "duplicate_in_sheet" | "already_in_db";

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
 * `existingKeys` are the identity keys (see identityKey) of clients ALREADY in
 * the database, so a second run of the import is a no-op instead of a duplicate
 * of the whole sheet.
 */
export function buildImportPlan(
  rows: SheetRow[],
  refs: KnownReferences,
  existingKeys: Iterable<string> = [],
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

  // Two sets, not one: a row matching the DATABASE is reported differently from
  // one repeating an earlier row of the same sheet, and a single set could not
  // tell them apart once a sheet key had been added to it.
  const dbKeys = new Set<string>([...existingKeys]);
  const sheetKeys = new Set<string>();
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

    // A row with no name cannot be identified or searched for later, so it is
    // dropped rather than imported as an unlabelled record.
    if (!row.name) {
      skipped.push({ rowNumber: row.rowNumber, name: "", phone: row.phone, reason: "no_name" });
      continue;
    }

    // The phone is the only stable identity the sheet carries, and the CRM's
    // own create form requires one, so a row without it is held back.
    if (!row.phone) {
      skipped.push({ rowNumber: row.rowNumber, name: row.name, phone: "", reason: "no_phone" });
      continue;
    }

    // Phone is the primary identity; rows whose phone column holds prose fall
    // back to name+project (see identityKey) so a re-run cannot duplicate them.
    const key = identityKey({ phone: row.phone, name: row.name, project: row.project });
    if (key && (dbKeys.has(key) || sheetKeys.has(key))) {
      skipped.push({
        rowNumber: row.rowNumber,
        name: row.name,
        phone: row.phone,
        reason: dbKeys.has(key) ? "already_in_db" : "duplicate_in_sheet",
      });
      continue;
    }
    if (key) sheetKeys.add(key);

    const status = STATUS_MAP[row.status] ?? row.status;
    const channel = resolveChannel(row.channel);
    const location = row.location;

    // addRef is a no-op for anything already known, and the known lists are
    // seeded with the built-ins above — so a mapped stage or a built-in channel
    // is never proposed as new.
    addRef(newStatuses, knownStatuses, status);
    addRef(newChannels, knownChannels, channel);
    addRef(newLocations, knownLocations, location);

    const mapped = statusCounts.get(row.status);
    if (mapped) mapped.count += 1;
    else statusCounts.set(row.status, { from: row.status, to: status, count: 1 });

    drafts.push({
      rowNumber: row.rowNumber,
      name: row.name,
      phoneNumber: tidyPhone(row.phone),
      status,
      // The CRM requires these; an empty cell becomes an empty string rather
      // than a placeholder string the user would later have to clean up.
      project: row.project,
      location,
      acquisitionChannel: channel,
      operationToTake: row.operation,
      firstContactPerson: row.firstContact,
      secondContactPerson: row.secondContact,
      // 56 of the 344 rows have no تاريخ التسجيل. They are imported with the
      // import time and flagged, because dropping a real lead over a missing
      // date would lose the client entirely.
      createdAt: row.registeredAt ?? now,
      dateAssumed: !row.registeredAt,
    });
  }

  return {
    drafts,
    skipped,
    newStatuses,
    newChannels,
    newLocations,
    statusMapping: [...statusCounts.values()].sort((a, b) => b.count - a.count),
    repairedRows,
  };
}

