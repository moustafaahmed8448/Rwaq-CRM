"use client";

/**
 * Translates the plain-English error messages returned by the API routes
 * (see src/app/api/**). Messages we know become Arabic/English dictionary
 * entries; raw driver/configuration noise becomes a generic message so nothing
 * technical ever reaches the UI.
 *
 * Usage:
 *   const body = await res.json().catch(() => ({}));
 *   setError(apiErrorMessage(t, body.error));
 */
type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Exact API message -> dictionary key. Keep in sync with src/app/api/**. */
const MESSAGES: Record<string, string> = {
  "Unauthorized": "errors.unauthorized",
  "Admin only": "errors.adminOnly",
  "Username and password are required": "errors.usernamePasswordRequired",
  "Incorrect username or password": "errors.badCredentials",
  "Username must be at least 2 characters": "errors.usernameMin",
  "Username required": "errors.usernameMin",
  "Username already taken": "errors.usernameTaken",
  "Username taken": "errors.usernameTaken",
  "Full name is required": "errors.nameRequired",
  "Name required": "errors.nameRequired",
  "Name cannot be empty": "errors.nameEmpty",
  "Password must be at least 6 characters": "errors.passwordMin",
  "Password min 6 chars": "errors.passwordMin",
  "User not found": "errors.userNotFound",
  "Cannot delete yourself": "errors.cannotDeleteSelf",
  "You cannot change your own role away from Admin": "errors.cannotChangeOwnRole",
  "Missing id": "errors.missingId",
  "Client not found": "errors.clientNotFound",
  "Not found": "errors.notFound",
  "Invalid acquisition channel": "errors.channelInvalid",
  "Invalid channel": "errors.channelInvalid",
  "Only admins can archive or restore clients": "errors.adminArchiveOnly",
  "Only admins can permanently delete clients. Archive it instead.": "errors.adminDeleteOnly",
  "Status label required": "errors.statusRequired",
  "Invalid status label": "errors.statusInvalid",
  "Status already exists": "errors.statusExists",
  "Channel name required": "errors.channelRequired",
  "Channel already exists": "errors.channelExists",
  "Location name required": "errors.locationRequired",
  "Location already exists": "errors.locationExists",
  "Notification id required": "errors.notificationIdRequired",
  "Channel, start date, and end date are required": "errors.metricFieldsRequired",
  "End date must be on or after the start date": "errors.dateOrder",
  "Numbers must be non-negative": "errors.nonNegative",
  "A metric already exists for this channel and date range": "errors.metricExists",
  "Logo required": "errors.logoRequired",
  "Invalid image data": "errors.logoInvalid",
  "Image is too large (max 2MB).": "errors.logoTooLarge",
};

/** Raw database / configuration noise that must never be shown to a user. */
const TECHNICAL =
  /prisma|P1\d{3}|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EACCES|syntax error|does not exist|DATABASE_URL|TWILIO_AUTH_TOKEN|Invalid Twilio signature|connect|timeout|fetch failed/i;

/** Turns an API `error` payload into a localized, user-safe message. */
export function apiErrorMessage(t: TFn, raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return t("errors.generic");
  const known = MESSAGES[raw.trim()];
  if (known) return t(known);
  return TECHNICAL.test(raw) ? t("errors.generic") : raw;
}

/** Reads `{ error }` from a response without throwing on non-JSON bodies. */
export async function readApiError(res: Response): Promise<unknown> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return data?.error;
  } catch {
    return undefined;
  }
}
