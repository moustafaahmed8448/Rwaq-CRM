/**
 * In-memory login brute-force throttle.
 *
 * The login route had no protection at all: an attacker could try passwords
 * against an account forever. This counts failed attempts per `username|ip` and
 * locks the key out for a cooling-off window once a threshold is crossed, so a
 * single account cannot be ground down by repeated guesses.
 *
 * Scope / limitation, stated plainly: this map lives in one server process. On a
 * multi-instance deployment (e.g. Vercel's serverless functions) each instance
 * keeps its own counters, so an attacker spraying many guesses would still be
 * throttled per instance and per key, but the counts are not shared. The durable
 * upgrade is a `LoginAttempt` table or a shared store (Redis); this module is the
 * dependency-free first line of defence and is deliberately swappable behind the
 * `checkLock` / `recordFailure` / `clearFailures` surface.
 *
 * The window and thresholds are constants rather than env vars for the same
 * reason as BUSINESS_TZ in business-days.ts: a silent env misconfiguration should
 * not be able to disable the guard. Changing them is a visible edit to this file.
 */

/** Failed attempts allowed before a key is locked. */
const MAX_ATTEMPTS = 5;
/** How long a lock lasts once tripped. */
const LOCK_MS = 15 * 60 * 1000; // 15 minutes
/** Age after which a key's counters are forgotten entirely. */
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; firstAt: number; lockedUntil: number };

const attempts = new Map<string, Entry>();

const keyOf = (username: string, ip: string): string =>
  `${String(username ?? "").trim().toLowerCase()}|${String(ip ?? "").trim() || "unknown"}`;

/** Milliseconds remaining on a lock, or 0 when the key may try again. */
export function checkLock(username: string, ip: string): number {
  const entry = attempts.get(keyOf(username, ip));
  if (!entry) return 0;
  if (entry.lockedUntil > Date.now()) return entry.lockedUntil - Date.now();
  // Lock expired (or never locked): forget the entry so counting restarts clean.
  if (entry.lockedUntil !== 0 && entry.lockedUntil <= Date.now()) attempts.delete(keyOf(username, ip));
  return 0;
}

/** Records a failed attempt, tripping a lock once the threshold is crossed. */
export function recordFailure(username: string, ip: string): void {
  const key = keyOf(username, ip);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCK_MS;
}

/** Clears a key's counters after a successful login. */
export function clearFailures(username: string, ip: string): void {
  attempts.delete(keyOf(username, ip));
}
