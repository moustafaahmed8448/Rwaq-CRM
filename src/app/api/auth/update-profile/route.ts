import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, updateUser } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();

  // The built-in demo account has no database row — accept the change in-memory.
  if (!sessionUser.username || sessionUser.username === "amira") {
    return NextResponse.json({
      ok: true,
      user: { name: name || sessionUser.name, email: email || sessionUser.email },
    });
  }

  try {
    const updated = await updateUser(sessionUser.username, {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ ok: true, user: { name: updated.name, email: updated.email } });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
