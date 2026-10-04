/**
 * Saudi Riyal display helpers.
 * sar(1250)        -> "SAR 1,250"
 * sar(12.5, 2)     -> "SAR 12.50"
 * sar("12.50")     -> "SAR 12.50"  (already-formatted values like CPM strings)
 */
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

/** YYYY-MM-DD in the LOCAL calendar. Mirrors `localDay` in src/app/page.tsx. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
