import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const USERS_FILE = path.join(process.cwd(), "data", "rwaq-users.json");

function getCustomUser(sessionValue: string) {
  if (!sessionValue.startsWith("rwaq-session-")) return null;
  const username = sessionValue.replace("rwaq-session-", "");
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const users: Array<{ username: string; name: string; email?: string }> = JSON.parse(raw);
    return users.find((u) => u.username === username) ?? null;
  } catch {
    return null;
  }
}

export function GET(request: NextRequest) {
  const session = request.cookies.get("rwaq_session")?.value;

  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });

  // Built-in demo user
  if (session === "rwaq-demo-session") {
    return NextResponse.json({ authenticated: true, user: { name: "Amira Mansour", initials: "AM", role: "Admin", email: "demo@rwaq.app" } });
  }

  // Custom user
  const custom = getCustomUser(session);
  if (custom) {
    return NextResponse.json({ authenticated: true, user: { name: custom.name, initials: custom.name.slice(0, 2).toUpperCase(), role: (custom as any).role || "Member", email: (custom as any).email ?? "" } });
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}
