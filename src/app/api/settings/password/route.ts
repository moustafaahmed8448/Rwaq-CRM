import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, findUser, updateUser } from "@/lib/db";

/**
 * Change the signed-in user's own password.
 *
 * The settings page has always posted here, but the route did not exist — so
 * "Update password" answered 404 and the UI showed a generic failure. It now
 * verifies the current password with bcrypt before writing the new hash, so a
 * stolen session cookie alone cannot change the password.
 *
 * Accounts must have a database row so the current password can be verified
 * before the new hash is stored.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are required" }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  if (!sessionUser.username) return unauthorized();

  try {
    const user = await findUser(sessionUser.username);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const matches = await bcrypt.compare(currentPassword, user.hash);
    if (!matches) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const updated = await updateUser(sessionUser.username, { hash });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
