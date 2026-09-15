import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { isAuthenticated, unauthorized, getSessionUser } from "@/lib/auth";

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
  const user = getSessionUser(request);
  // Only admin can list users
  const users = readUsers();
  const publicUsers = users.map(({ username, name, email, role }) => ({ username, name, email, role: role ?? "Member" }));
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
  const role = body.role === "admin" ? "Admin" : "Member";

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
