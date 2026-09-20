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
