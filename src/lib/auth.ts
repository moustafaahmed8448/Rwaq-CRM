import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const USERS_FILE = path.join(process.cwd(), "data", "rwaq-users.json");

export function isAuthenticated(request: NextRequest): boolean {
  const session = request.cookies.get("rwaq_session")?.value;
  if (!session) return false;
  if (session === "rwaq-demo-session") return true;
  if (session.startsWith("rwaq-session-")) {
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const users: Array<{ username: string }> = JSON.parse(raw);
      const username = session.replace("rwaq-session-", "");
      return users.some((u) => u.username === username);
    } catch {
      return false;
    }
  }
  return false;
}

export function getSessionUser(request: NextRequest): { name: string; initials: string; role: string; email?: string } | null {
  const session = request.cookies.get("rwaq_session")?.value;
  if (session === "rwaq-demo-session") return { name: "Amira Mansour", initials: "AM", role: "Admin" };
  if (session?.startsWith("rwaq-session-")) {
    const username = session.replace("rwaq-session-", "");
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const users: Array<{ username: string; name: string }> = JSON.parse(raw);
      const user = users.find((u) => u.username === username);
      if (user) return { name: user.name, initials: user.name.slice(0, 2).toUpperCase(), role: "Member", email: (user as any).email };
    } catch {}
  }
  return null;
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
