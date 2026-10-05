import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, updateUser } from "@/lib/db";
import { readAvatar } from "@/lib/avatar-payload";

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const language = String(body.language ?? "").trim().toLowerCase();

  /* The photo, validated through the SAME helper the /users form and
     /api/auth/me use. It was missing here, so a caller that sent `avatar` got a
     cheerful `{ ok: true }` and nothing was stored — indistinguishable from a
     successful save, which is exactly how the "Profile saved successfully"
     message survived a photo that never reached the database.

     `undefined` means "not part of this request", `null` means "clear it". A
     junk payload is REJECTED rather than ignored, for the same reason. */
  let avatar: string | null | undefined;
  if (body.avatar !== undefined) {
    const read = readAvatar(body.avatar);
    if (read === undefined) {
      return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
    }
    avatar = read;
  }

  // The built-in demo account has no database row — accept the change in-memory.
  if (!sessionUser.username || sessionUser.username === "amira") {
    return NextResponse.json({
      ok: true,
      // The demo account has nowhere to persist a photo, so it is NOT echoed as
      // stored. Saying otherwise is what made a save look successful on an
      // account that can never hold one.
      user: {
        name: name || sessionUser.name,
        email: email || sessionUser.email,
        ...(language === "ar" || language === "en" ? { language } : {}),
      },
      ...(avatar ? { avatar: null } : {}),
    });
  }

  try {
    const updated = await updateUser(sessionUser.username, {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(language === "ar" || language === "en" ? { language } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      // Echo the STORED values, not what was sent, so the client re-renders from
      // the server's copy rather than from its own optimistic guess.
      user: { name: updated.name, email: updated.email, language: updated.language },
      ...(avatar !== undefined ? { avatar: updated.avatar ?? null } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
