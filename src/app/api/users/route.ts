import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { isAuthenticated, unauthorized, getSessionUser, normalizeRole } from "@/lib/auth";

const USERS_FILE = path.join(process.cwd(), "data", "rwaq-users.json");

type UserRecord = { username: string; name: string; email?: string; role?: string; hash?: string }; function readUsers(): UserRecord[] {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch { return []; }
}

function writeUsers(users: UserRecord[]) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const users = readUsers();
  const publicUsers = users.map(({ username, name, email, role }) => ({ username, name, email, role: normalizeRole(role, username) }));
  return NextResponse.json({ users: publicUsers });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const currentUser = getSessionUser(request);
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

  const users = readUsers();
  if (users.some(u => u.username === username)) return NextResponse.json({ error: "Username taken" }, { status: 409 });

  const hash = await bcrypt.hash(password, 10);
  users.push({ username, name, email: email || undefined, role, hash });
  writeUsers(users);
  return NextResponse.json({ ok: true, user: { username, name, email, role } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const currentUser = getSessionUser(request);
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

  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (newUsername !== username && users.some((u) => u.username === newUsername)) {
    return NextResponse.json({ error: "Username taken" }, { status: 409 });
  }

  // Lockout guards: an admin can't demote themselves or end up logged out
  const isSelf = username === currentUser.username;
  if (isSelf && role !== undefined && role !== "Admin") {
    return NextResponse.json({ error: "You cannot change your own role away from Admin" }, { status: 400 });
  }

  const updated: UserRecord = { ...users[idx] };
  if (name !== undefined) updated.name = name;
  if (email !== undefined) updated.email = email || undefined;
  if (role !== undefined) updated.role = role;
  updated.username = newUsername;
  users[idx] = updated;
  writeUsers(users);

  // If the admin renamed themselves, re-issue the session cookie so they stay logged in
  const res = NextResponse.json({ ok: true, user: { username: newUsername, name: updated.name, email: updated.email, role: normalizeRole(updated.role, newUsername) } });
  if (isSelf && newUsername !== username) {
    res.cookies.set("rwaq_session", `rwaq-session-${newUsername}`, {
      httpOnly: true, sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 8, path: "/",
    });
  }
  return res;
}

export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const currentUser = getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });
  if (username === (request.cookies.get("rwaq_session")?.value ?? "").replace("rwaq-session-", "")) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }
  const users = readUsers().filter(u => u.username !== username);
  writeUsers(users);
  return NextResponse.json({ ok: true });
}
