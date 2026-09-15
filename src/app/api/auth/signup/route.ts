import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { hasDatabase, prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();

  if (!username || username.length < 2)
    return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
  if (!name)
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (password.length < 6)
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });

  // Prevent duplicate usernames
  const fs = await import("fs");
  const path = await import("path");
  const usersPath = path.join(process.cwd(), "data", "rwaq-users.json");
  let users: Array<{ username: string; name: string; email?: string; role?: string; hash: string }> = [];
  try {
    const raw = fs.readFileSync(usersPath, "utf-8");
    users = JSON.parse(raw);
  } catch { /* fresh start */ }

  if (users.some((u) => u.username === username))
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });

  const hash = await bcrypt.hash(password, 10);
  users.push({ username, name, email: body.email ?? "", role: "Member", hash });
  if (!fs.existsSync(path.join(process.cwd(), "data"))) fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

  const response = NextResponse.json({ user: { name, initials: name.slice(0, 2).toUpperCase(), email: body.email ?? "" } }, { status: 201 });
  response.cookies.set("rwaq_session", `rwaq-session-${username}`, {
    httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8, path: "/",
  });
  return response;
}
