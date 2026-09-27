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
 * Locale used for UI dates and times.
 *
 * Arabic stays on the Gregorian calendar with Latin digits ("ar-SA-u-ca-gregory-nu-latn")
 * so numbers keep the same shape as the rest of the CRM and users never get an
 * unexpected Hijri date; English uses day-first formatting.
 */
export function dateLocale(lang: string): string {
  return lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
}
