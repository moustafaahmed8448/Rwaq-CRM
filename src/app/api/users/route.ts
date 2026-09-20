import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, isAuthenticated, getSessionUser, normalizeRole, sessionCookieOptions, sessionCookieValue, unauthorized } from "@/lib/auth";
import { createUser, databaseErrorMessage, deleteUser, findUser, listUsers, updateUser } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const users = await listUsers();
    const publicUsers = users.map(({ username, name, email, role }) => ({
      username,
      name,
      email,
      role: normalizeRole(role, username),
    }));
    return NextResponse.json({ users: publicUsers });
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
    await createUser({ username, name, email: email || undefined, role, hash });
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

    const updated = await updateUser(username, {
      newUsername,
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(role !== undefined ? { role } : {}),
    });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const res = NextResponse.json({
      ok: true,
      user: {
        username: updated.username,
        name: updated.name,
        email: updated.email,
        role: normalizeRole(updated.role, updated.username),
      },
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
