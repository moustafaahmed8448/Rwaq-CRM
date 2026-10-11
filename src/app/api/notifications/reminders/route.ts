import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import {
  createNotification,
  databaseErrorMessage,
  FOLLOW_UP_DUE_TYPE,
  hasReminderSince,
  listFollowUpsDueFor,
  readNotifPrefs,
} from "@/lib/db";
import { addBusinessDays, businessDayKey, startOfBusinessDay, startOfBusinessToday } from "@/lib/business-days";

/**
 * Materialize follow-up reminders for the signed-in user.
 *
 * The dashboard can FILTER to a due/overdue bucket, but nothing ever PUSHED a
 * "this follow-up is due" signal to the rep. This pass turns every live client
 * the user owns whose follow-up date is today-or-earlier into a single
 * notification, once per day per client (guarded by hasReminderSince).
 *
 * Called on load by the notifications page and the header, so no cron/scheduler
 * is required. It is intentionally idempotent and cheap: for a rep with nothing
 * due it does one indexed query and returns. POST (not GET) so a prefetch or a
 * crawler cannot trigger writes.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const user = await getSessionUser(request);
  if (!user) return unauthorized();

  // Admins see the whole book but are not "assigned" clients by name, so a
  // name-scoped reminder pass would find nothing for them. Skip quietly rather
  // than notifying an admin about every rep's follow-ups.
  if (user.role === "Admin" || user.role === "Visitor") {
    return NextResponse.json({ ok: true, created: 0 });
  }

  try {
    // Respect the per-user mute: a rep who turned reminders off in Settings gets
    // none, and we do no work at all rather than creating then discarding them.
    if (user.username) {
      const prefs = await readNotifPrefs(user.username);
      if (!prefs.followUpReminders) return NextResponse.json({ ok: true, created: 0, muted: true });
    }

    // "Due" means the follow-up date is on or before the END of the current
    // business day. The boundary is the start of the next business day, computed
    // in BUSINESS_TZ so it agrees with the dashboard's follow-up buckets rather
    // than the host clock.
    const todayStart = startOfBusinessToday();
    const endOfToday = startOfBusinessDay(addBusinessDays(businessDayKey(todayStart), 1));

    const due = await listFollowUpsDueFor(user.name, endOfToday);

    let created = 0;
    for (const client of due) {
      // One reminder per client per day: skip if we already made one since the
      // start of today, so repeated loads do not stack duplicates.
      if (await hasReminderSince(user.name, client.id, todayStart)) continue;
      await createNotification({
        recipient: user.name,
        type: FOLLOW_UP_DUE_TYPE,
        // Legacy English fallback; the UI localizes FOLLOW_UP_DUE at render time.
        message: `Follow-up due for “${client.name}”`,
        clientId: client.id,
        clientName: client.name,
      });
      created += 1;
    }

    return NextResponse.json({ ok: true, created });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
