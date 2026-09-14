import { AcquisitionChannel, ClientStatus } from "@prisma/client";
export const channelLabels: Record<AcquisitionChannel, string> = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", X: "X", TIKTOK: "TikTok", GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", CALLS: "Calls", SALES: "Sales" };
export const channelValues = Object.keys(channelLabels) as AcquisitionChannel[];
export const statusValues = ["WAITING", "WON", "LOST"] as const;
export function parseChannel(value: unknown): AcquisitionChannel | undefined { if (typeof value !== "string") return; const key = value.trim().toUpperCase().replace(/[ /-]+/g, "_"); const aliases: Record<string, AcquisitionChannel> = { FACEBOOK: "FACEBOOK", INSTAGRAM: "INSTAGRAM", META: "FACEBOOK", TWITTER: "X", X: "X", TIKTOK: "TIKTOK", GOOGLE: "GOOGLE_ADS", GOOGLE_ADS: "GOOGLE_ADS", WHATSAPP: "WHATSAPP", CALL: "CALLS", CALLS: "CALLS", SALES: "SALES" }; return aliases[key]; }
export function parseStatus(value: unknown): ClientStatus | undefined { if (typeof value !== "string") return; const key = value.trim().toUpperCase().replace(/[ /-]+/g, "_"); return statusValues.includes(key as (typeof statusValues)[number]) ? key as ClientStatus : undefined; }
export const startOfWeek = (date = new Date()) => { const value = new Date(date); const day = value.getDay(); value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day)); value.setHours(0, 0, 0, 0); return value; };
export const endOfWeek = (date = new Date()) => { const value = startOfWeek(date); value.setDate(value.getDate() + 7); return value; };
