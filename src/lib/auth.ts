import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const USERS_FILE = path.join(process.cwd(), "data", "rwaq-users.json");

export type Role = "Admin" | "Sales" | "CRM";
export const ROLES: Role[] = ["Admin", "Sales", "CRM"];

/** Normalize any stored role value into one of the three supported roles. */
export function normalizeRole(role?: string, username?: string): Role {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "admin") return "Admin";
  if (r === "sales") return "Sales";
  if (r === "crm") return "CRM";
  if (r === "member") return "Sales";
  // The workspace owner always keeps full privileges.
  if (String(username ?? "").trim().toLowerCase() === "moustafa") return "Admin";
  return "Sales";
}

export type SessionUser = { username?: string; name: string; initials: string; role: Role; email?: string };

export function readUserRecords(): Array<{ username: string; name: string; email?: string; role?: string }> {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function isAuthenticated(request: NextRequest): boolean {
  const session = request.cookies.get("rwaq_session")?.value;
  if (!session) return false;
  if (session === "rwaq-demo-session") return true;
  if (session.startsWith("rwaq-session-")) {
    const username = session.replace("rwaq-session-", "");
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const users: Array<{ username: string }> = JSON.parse(raw);
      return users.some((u) => u.username === username);
    } catch {
      return false;
    }
  }
  return false;
}

export function getSessionUser(request: NextRequest): SessionUser | null {
  const session = request.cookies.get("rwaq_session")?.value;
  if (session === "rwaq-demo-session") return { username: "amira", name: "Amira Mansour", initials: "AM", role: "Admin", email: "demo@rwaq.app" };
  if (session?.startsWith("rwaq-session-")) {
    const username = session.replace("rwaq-session-", "");
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const users: Array<{ username: string; name: string; email?: string; role?: string }> = JSON.parse(raw);
      const user = users.find((u) => u.username === username);
      if (user) {
        return {
          username: user.username,
          name: user.name,
          initials: user.name.slice(0, 2).toUpperCase(),
          role: normalizeRole(user.role, user.username),
          email: user.email,
        };
      }
    } catch {}
  }
  return null;
}

export function requireRole(request: NextRequest, roles: Role[]): SessionUser | null {
  const user = getSessionUser(request);
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
