import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isAuthenticated, unauthorized, getSessionUser } from "@/lib/auth";

const USERS_FILE = path.join(process.cwd(), "data", "rwaq-users.json");

export async function PATCH(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const sessionUser = getSessionUser(request);
  if (!sessionUser) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();

  if (sessionUser.role === "Admin") {
    // Demo user - just update in-memory representation
    return NextResponse.json({ ok: true, user: { name: name || sessionUser.name, email: email || sessionUser.email } });
  }

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const users: Array<{ username: string; name: string; email?: string; hash: string }> = JSON.parse(raw);
    const username = sessionUser.name.toLowerCase(); // session uses username as identifier
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (name) users[idx].name = name;
    if (email) users[idx].email = email;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return NextResponse.json({ ok: true, user: { name: users[idx].name, email: users[idx].email } });
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
