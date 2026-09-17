import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized, getSessionUser } from "@/lib/auth";
import { readNotifications, writeNotifications } from "@/lib/storage";

function matches(recipient: string, userName: string) {
  const r = recipient.trim().toLowerCase();
  const u = userName.trim().toLowerCase();
  if (!r || !u) return false;
  return u === r || u.startsWith(r) || r.startsWith(u.split(" ")[0]);
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const name = getSessionUser(request)?.name ?? "";
  const mine = readNotifications().filter((n) => matches(n.recipient, name));
  return NextResponse.json({ notifications: mine, unread: mine.filter((n) => !n.read).length });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const name = getSessionUser(request)?.name ?? "";
  const body = await request.json().catch(() => ({}));
  const id = body.id ? String(body.id) : null;
  const items = readNotifications().map((n) => {
    if (!matches(n.recipient, name)) return n;
    if (id && n.id !== id) return n;
    return { ...n, read: true };
  });
  writeNotifications(items);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const name = getSessionUser(request)?.name ?? "";
  const body = await request.json().catch(() => ({}));
  const items = readNotifications();
  const mine = (n: (typeof items)[number]) => matches(n.recipient, name);

  let remaining = items;
  if (body.clearRead) {
    // Delete every read notification belonging to this user ("clear history")
    remaining = items.filter((n) => !(mine(n) && n.read));
  } else {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Notification id required" }, { status: 400 });
    remaining = items.filter((n) => !(mine(n) && n.id === id));
  }

  writeNotifications(remaining);
  return NextResponse.json({ ok: true });
}