import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, readNotifPrefs, writeNotifPrefs } from "@/lib/db";

/**
 * Per-user notification preferences (GET to read, PATCH to update).
 *
 * Lets a rep turn OFF the follow-up reminders added in /api/notifications/reminders
 * without affecting anyone else. Preferences are the user's own, so no role gate
 * beyond being signed in — you can always mute yourself.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const user = await getSessionUser(request);
  if (!user?.username) return unauthorized();
  try {
    return NextResponse.json({ prefs: await readNotifPrefs(user.username) });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const user = await getSessionUser(request);
  if (!user?.username) return unauthorized();

  const body = await request.json().catch(() => ({}));
  // Only the known key is read, and only a real boolean is accepted, so an
  // arbitrary payload cannot smuggle in an unknown preference.
  if (typeof body.followUpReminders !== "boolean") {
    return NextResponse.json({ error: "followUpReminders must be a boolean" }, { status: 400 });
  }

  try {
    await writeNotifPrefs(user.username, { followUpReminders: body.followUpReminders });
    return NextResponse.json({ ok: true, prefs: { followUpReminders: body.followUpReminders } });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
