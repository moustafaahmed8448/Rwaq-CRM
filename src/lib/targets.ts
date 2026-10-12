export type MonthlyTargets = {
  monthlyWon: number;
  monthlySpendCeiling: number | null;
};

export function coerceMonthlyTargets(value: unknown): MonthlyTargets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.monthlyWon) || Number(raw.monthlyWon) < 1) return null;
  const spend = raw.monthlySpendCeiling;
  if (spend !== null && spend !== undefined && (typeof spend !== "number" || !Number.isFinite(spend) || spend <= 0)) {
    return null;
  }
  return {
    monthlyWon: Number(raw.monthlyWon),
    monthlySpendCeiling: typeof spend === "number" ? spend : null,
  };
}
