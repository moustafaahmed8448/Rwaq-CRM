// Channel / status helpers.
//
// These are plain strings rather than Prisma enums so the app can store
// user-defined channels (e.g. FORSA) and custom statuses (e.g. NEW).

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

export const statusValues = ["WAITING", "WON", "LOST"] as const;

/** Fallback labels used when a translation entry is missing. */
export const statusLabels: Record<string, string> = { WAITING: "Waiting", WON: "Won", LOST: "Lost" };

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
const STATUS_KEYS: Record<string, string> = {
  WAITING: "status.waitingLabel",
  WON: "status.wonLabel",
  LOST: "status.lostLabel",
};
/** App roles stored on AppUser.role (never renamed, only displayed translated). */
const ROLE_KEYS: Record<string, string> = {
  Admin: "role.admin",
  Sales: "role.sales",
  CRM: "role.crm",
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
  const fallback = statusLabels[status];
  return key && fallback ? translated(t, key, fallback) : status;
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
 * translated; every other value is user data and is returned untouched.
 */
export function activityValueLabel(t: TranslateFn, field: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (value.trim() === "") return t("form.unassigned");
  const key = fieldKey(field);
  if (key === "status") return statusLabel(t, value);
  if (key === "acquisitionChannel") return channelLabel(t, value);
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
  return key;
}

export const startOfWeek = (date = new Date()) => {
  const value = new Date(date);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  value.setHours(0, 0, 0, 0);
  return value;
};

export const endOfWeek = (date = new Date()) => {
  const value = startOfWeek(date);
  value.setDate(value.getDate() + 7);
  return value;
};
