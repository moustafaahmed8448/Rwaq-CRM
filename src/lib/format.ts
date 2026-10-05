/**
 * Saudi Riyal display helpers.
 * sar(1250)        -> "SAR 1,250"
 * sar(12.5, 2)     -> "SAR 12.50"
 * sar("12.50")     -> "SAR 12.50"  (already-formatted values like CPM strings)
 */
import { businessDayKey } from "./business-days";

export function sar(value: number | string, decimals = 0): string {
  if (typeof value === "string") return `SAR ${value}`;
  return `SAR ${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Thousands-separated number using a fixed locale.
 *
 * A bare `toLocaleString()` resolves to the runtime default, which differs
 * between the Node server and the user's browser — "1,234" on en-US, "1.234" on
 * de-DE — so the first client render would not match the server HTML. Pinning
 * the locale keeps digits Western, consistent with sar() and dateLocale().
 */
export function num(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Locale used for UI dates and times.
 *
 * Arabic stays on the Gregorian calendar with Latin digits ("ar-SA-u-ca-gregory-nu-latn")
 * so numbers keep the same shape as the rest of the CRM and users never get an
 * unexpected Hijri date; English uses day-first formatting.
 */
export function dateLocale(lang: string): string {
  return lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
}

/**
 * YYYY-MM-DD that a `Date` belongs to, in BUSINESS_TZ.
 *
 * Was the browser's own calendar (`getFullYear`/`getMonth`/`getDate`). That made
 * "a day" mean something different on each side of the wire: the follow-up
 * buckets counted here in the browser and there in SQL, and on Vercel — whose
 * clock is UTC — the two disagreed for three hours a day. Everything that wants
 * a business day now goes through this one function.
 *
 * The name is kept so the many existing call sites read naturally; `businessDayKey`
 * in src/lib/business-days.ts is the implementation.
 */
export function localDayKey(d: Date): string {
  return businessDayKey(d);
}

/**
 * Renders a stored timestamp as the `YYYY-MM-DD` a date input expects, or "".
 *
 * Built from LOCAL calendar parts on purpose. `.toISOString().slice(0, 10)`
 * returns the UTC day, so a follow-up set to local midnight on the 3rd reads
 * back as the 2nd for anyone east of Greenwich — silently shifting the date by a
 * day every time the form is opened and saved.
 */
export function dateInputValue(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : localDayKey(d);
}

/**
 * True when a follow-up is set and its DAY has already passed.
 *
 * Compared by day rather than by instant on purpose: a follow-up set for earlier
 * today is due, not overdue — it is not yet behind. Comparing raw timestamps
 * would flag a 09:00 follow-up as overdue from 00:01 the same day.
 */
export function isOverdue(value?: string | null, now: Date = new Date()): boolean {
  const key = dateInputValue(value);
  if (!key) return false;
  return key < localDayKey(now);
}

/**
 * Digits-only phone, for `tel:` / `wa.me` links.
 *
 * Stored numbers carry spaces, dashes, parentheses or a leading `+`; dial and
 * WhatsApp links need the plain digits. A leading `00` is folded to nothing
 * (the stored value already carries the country code in that form).
 */
export function phoneDigits(phone?: string | null): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.replace(/^00/, "");
}

/** `tel:` link for a stored phone number, or "" when there is nothing to dial. */
export function telHref(phone?: string | null): string {
  const digits = phoneDigits(phone);
  return digits ? `tel:+${digits}` : "";
}

/** `wa.me` link for a stored phone number, or "" when there is nothing to message. */
export function whatsAppHref(phone?: string | null): string {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/${digits}` : "";
}
