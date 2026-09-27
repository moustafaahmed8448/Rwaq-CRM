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
