/**
 * Server-side validation for an incoming avatar payload.
 *
 * Deliberately NOT in lib/avatar.ts: that module is "use client" (it holds the
 * browser canvas downscaler), so importing anything from it into a route handler
 * turns the function into a client reference and calling it server-side throws
 * "Attempted to call readAvatar() from the server but readAvatar is on the
 * client" — every avatar save fails with a 500. This file has no directive for
 * exactly that reason; keep it that way.
 *
 * Shared rather than duplicated because there are two writers: the /users form
 * (admin, any team member) and /settings (your own account, via
 * PATCH /api/auth/me). They must accept and reject the same payloads, or a photo
 * that saves on one screen is refused on the other.
 */

/**
 * Longest accepted avatar payload, in characters.
 *
 * The client downscales before sending (readAvatarFile), so a real avatar is a
 * few tens of KB. A hand-crafted request is not, and this field is returned to
 * every admin who opens /users — an unbounded string here is a cheap way to make
 * that one response enormous. Kept above the largest plausible real payload.
 */
export const MAX_AVATAR_CHARS = 400_000;

/**
 * Only a downscaled PNG data URL is a legitimate value.
 *
 * Three outcomes, and the difference matters. `undefined` means "not part of this
 * request" (or junk we refuse to store) and the caller must leave the column
 * alone; `null` means "explicitly cleared" and the caller must unset it. Collapsing
 * the empty string into `undefined` — as the /settings upload originally did —
 * made the Remove photo button silently do nothing, because blanking a form
 * field and omitting a key from a partial PATCH are then indistinguishable.
 */
export function readAvatar(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string") return undefined;
  if (input === "") return null;
  if (!input.startsWith("data:image/png;base64,")) return undefined;
  return input.length > MAX_AVATAR_CHARS ? undefined : input;
}