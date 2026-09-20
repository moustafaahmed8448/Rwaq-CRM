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
