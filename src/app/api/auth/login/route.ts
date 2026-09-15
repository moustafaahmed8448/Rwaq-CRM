import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { hasDatabase, prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!username || !password)
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });

  // Check built-in demo user first
  if (username === "amira" && password === "rwaq2026") {
    const response = NextResponse.json({
      user: { name: "Amira Mansour", initials: "AM", role: "Admin" },
    });
    response.cookies.set("rwaq_session", "rwaq-demo-session", {
      httpOnly: true, sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 8, path: "/",
    });
    return response;
  }

  // Check custom users stored in localStorage (server-rendered — read from DB or environment)
  // Since localStorage is client-side only, we store a server-side sessions file as fallback
  let customUser: { username: string; name: string; hash: string } | null = null;

  if (hasDatabase()) {
    try {
      const record = await prisma.client.findFirst({ where: { id: `user:${username}` } });
      if (record && record.phoneNumber === "---") {
        // Restore hash from a side-channel: we stored it alongside the user
        // For simplicity, regenerate from the password check below won't work —
        // instead we'll use the demo-users.json file approach
      }
    } catch { /* ignore */ }
  }

  // Read custom users from a local JSON file (persisted between restarts)
  const fs = await import("fs");
  const path = await import("path");
  const usersPath = path.join(process.cwd(), "data", "rwaq-users.json");
  try {
    const raw = fs.readFileSync(usersPath, "utf-8");
    const users: Array<{ username: string; name: string; hash: string }> = JSON.parse(raw);
    customUser = users.find((u) => u.username === username) ?? null;
  } catch {
    // No file yet
  }

  if (customUser) {
    const match = await bcrypt.compare(password, customUser.hash);
    if (!match)
      return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
    const response = NextResponse.json({
      user: { name: customUser.name, initials: customUser.name.slice(0, 2).toUpperCase(), role: "Member" },
    });
    response.cookies.set("rwaq_session", `rwaq-session-${customUser.username}`, {
      httpOnly: true, sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 8, path: "/",
    });
    return response;
  }

  return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
}
