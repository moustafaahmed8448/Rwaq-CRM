import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import {
  databaseErrorMessage,
  deleteNotifications,
  listNotificationsFor,
  markNotificationsRead,
} from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const name = (await getSessionUser(request))?.name ?? "";
  try {
    const mine = await listNotificationsFor(name);
    return NextResponse.json({ notifications: mine, unread: mine.filter((n) => !n.read).length });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const name = (await getSessionUser(request))?.name ?? "";
  const body = await request.json().catch(() => ({}));
  const id = body.id ? String(body.id) : undefined;
  try {
    await markNotificationsRead(name, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const name = (await getSessionUser(request))?.name ?? "";
  const body = await request.json().catch(() => ({}));

  try {
    if (body.clearRead) {
      // Delete every read notification belonging to this user ("clear history")
      await deleteNotifications(name, { clearRead: true });
      return NextResponse.json({ ok: true });
    }

    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Notification id required" }, { status: 400 });
    await deleteNotifications(name, { id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}