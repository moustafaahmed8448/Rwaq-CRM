import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, isAuthenticated, getSessionUser, normalizeRole, sessionCookieOptions, sessionCookieValue, unauthorized } from "@/lib/auth";
import { createUser, databaseErrorMessage, deleteUser, findUser, listUsers, updateUser } from "@/lib/db";
import { readAvatar } from "@/lib/avatar-payload";

/** Trimmed optional text, with `null` meaning "clear this field". */
function readOptional(input: unknown, max = 2000): string | null | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}

/** The profile fields /api/users exposes, shaped for the table and the panel. */
function publicUser(u: {
  username: string; name: string; email?: string; role: string;
  avatar?: string; phone?: string; jobTitle?: string; notes?: string; createdAt?: string;
}) {
  return {
    username: u.username,
    name: u.name,
    email: u.email,
    role: normalizeRole(u.role, u.username),
    avatar: u.avatar ?? null,
    phone: u.phone ?? null,
    jobTitle: u.jobTitle ?? null,
    notes: u.notes ?? null,
    createdAt: u.createdAt ?? null,
  };
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const users = await listUsers();
    return NextResponse.json({ users: users.map(publicUser) });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const role = normalizeRole(String(body.role ?? "Sales"));

  if (!username || username.length < 2) return NextResponse.json({ error: "Username required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!password || password.length < 6) return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });

  try {
    if (await findUser(username)) return NextResponse.json({ error: "Username taken" }, { status: 409 });

    const hash = await bcrypt.hash(password, 10);
    await createUser({
      username, name, email: email || undefined, role, hash,
      // A new row has nothing to clear, so `null` collapses to "leave unset".
      avatar: readAvatar(body.avatar) ?? undefined,
      phone: readOptional(body.phone, 60) ?? undefined,
      jobTitle: readOptional(body.jobTitle, 120) ?? undefined,
      notes: readOptional(body.notes) ?? undefined,
    });
    return NextResponse.json({ ok: true, user: { username, name, email, role } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });

  const newUsername = body.newUsername !== undefined ? String(body.newUsername).trim().toLowerCase() : username;
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const email = body.email !== undefined ? String(body.email).trim() : undefined;
  const role = body.role !== undefined ? normalizeRole(String(body.role)) : undefined;

  if (newUsername.length < 2) return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
  if (name !== undefined && !name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });

  // Lockout guards: an admin can't demote themselves or end up logged out
  const isSelf = username === String(currentUser.username ?? "").toLowerCase();
  if (isSelf && role !== undefined && role !== "Admin") {
    return NextResponse.json({ error: "You cannot change your own role away from Admin" }, { status: 400 });
  }

  try {
    const existing = await findUser(username);
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (newUsername !== username) {
      const clash = await findUser(newUsername);
      if (clash) return NextResponse.json({ error: "Username taken" }, { status: 409 });
    }

    // Read each optional field ONCE. `null` from readOptional means "clear this",
    // `undefined` means "not in the body" — spreading only the latter is what
    // keeps a partial save from blanking the fields it did not mention.
    const avatar = readAvatar(body.avatar);
    const phone = readOptional(body.phone, 60);
    const jobTitle = readOptional(body.jobTitle, 120);
    const notes = readOptional(body.notes);

    const updated = await updateUser(username, {
      newUsername,
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(jobTitle !== undefined ? { jobTitle } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const res = NextResponse.json({
      ok: true,
      // publicUser, not a hand-built literal: this response is what the table and
      // the panel re-render from after a save, so it has to carry the same shape
      // GET does or the new photo/phone/title would vanish on the next refresh.
      user: publicUser(updated),
    });

    // If the admin renamed themselves, re-issue the session cookie so they stay logged in
    if (isSelf && newUsername !== username) {
      res.cookies.set(SESSION_COOKIE, sessionCookieValue(newUsername), sessionCookieOptions);
    }
    return res;
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });

  if (username === String(currentUser.username ?? "").toLowerCase()) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  try {
    await deleteUser(username);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
