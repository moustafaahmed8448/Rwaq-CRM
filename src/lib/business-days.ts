/**
 * What "a day" means to this application.
 *
 * The bug this exists to prevent: the clients table filtered in SQL using the
 * SERVER's local midnight, while the header badge counted in the BROWSER using
 * its own local day. On a laptop those agree — `next dev` runs in the same
 * timezone as the browser — so nothing looked wrong locally. On Vercel the server
 * runs in UTC, so "last 30 days" counted from 00:00Z while the user meant 00:00
 * Riyadh (21:00Z the previous evening). Clients created in that 3-hour window
 * belonged to the user's day but not the server's: the header said 188, the
 * paged table said 182, from one filter on one screen.
 *
 * So a day is no longer "whatever this host thinks". It is a day in
 * BUSINESS_TZ, computed through Intl with an explicit `timeZone`, which means
 * the answer is identical whether the code runs in a browser in Riyadh, a Node
 * server in UTC, or a CI box anywhere else.
 *
 * Deliberately a constant rather than an env var: a deploy that forgot to set
 * TZ=Asia/Riyadh would silently revert to UTC and reintroduce exactly the bug
 * above. Changing this should be a visible edit to this file.
 */
export const BUSINESS_TZ = "Asia/Riyadh";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Wall-clock parts of an instant, as seen in BUSINESS_TZ. */
function parts(instant: Date) {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  // Some ICU builds render midnight as hour 24 even with hour12:false. Without
  // this, every midnight boundary would land a whole day out.
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/**
 * How far BUSINESS_TZ is ahead of UTC at a given instant, in ms.
 *
 * Derived by reading the instant's zone-local parts, reinterpreting them as UTC,
 * and differencing. Riyadh is UTC+3 year-round, so this is a constant — but it
 * is computed rather than hard-coded so the helper stays correct if BUSINESS_TZ
 * is ever pointed at a zone with DST.
 */
function zoneOffsetMs(instant: Date): number {
  const p = parts(instant);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which a `YYYY-MM-DD` day begins in BUSINESS_TZ.
 *
 * This is the value a SQL comparison needs — `createdAt >= startOfBusinessDay(x)`
 * means "created on or after that business day".
 */
export function startOfBusinessDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const midnightAsUtc = Date.UTC(y || 1970, (m ?? 1) - 1, d ?? 1);
  // One pass is exact except within a DST transition hour, where the offset used
  // to resolve it is the one on the far side of the change. A second pass
  // settles that. Riyadh has no DST, so the second pass is a no-op today.
  const first = midnightAsUtc - zoneOffsetMs(new Date(midnightAsUtc));
  return new Date(midnightAsUtc - zoneOffsetMs(new Date(first)));
}

/**
 * The start of the following business day — the EXCLUSIVE upper bound that
 * makes an end date inclusive.
 *
 * A filter written "1st to 5th" means all of the 5th, but `createdAt <= 5th
 * midnight` drops every client registered during the 5th. Comparing against the
 * start of the 6th keeps the whole day.
 */
export function startOfNextBusinessDay(day: string): Date {
  return startOfBusinessDay(addBusinessDays(day, 1));
}

/** The `YYYY-MM-DD` an instant belongs to, in BUSINESS_TZ. "" if unparseable. */
export function businessDayKey(instant: Date | string | null | undefined): string {
  if (!instant) return "";
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Midnight of the current business day. */
export function startOfBusinessToday(now: Date = new Date()): Date {
  return startOfBusinessDay(businessDayKey(now) || "1970-01-01");
}

/**
 * Shifts a `YYYY-MM-DD` key by whole days.
 *
 * Pure calendar arithmetic on the key, never on an instant — adding 24h to a
 * zoned midnight is what breaks across a DST change, and a date key has no zone
 * to break. Done in UTC purely as a convenient calendar.
 */
export function addBusinessDays(day: string, days: number): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(y || 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}