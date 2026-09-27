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
