import { NextRequest, NextResponse } from "next/server";
import { findUser } from "./db";

/**
 * Session handling. Users live in Postgres (AppUser); this module is async
 * because every lookup hits the database. All call sites must `await`.
 */

export type Role = "Admin" | "Sales" | "CRM" | "Visitor";
export const ROLES: Role[] = ["Admin", "Sales", "CRM", "Visitor"];

/**
 * Visitor is strictly read-only: it may look at results but must never change
 * or destroy data. Checked in the API routes (the real enforcement) and mirrored
 * in the UI so the buttons are hidden — the UI check alone would be cosmetic.
 */
export function canWrite(role?: string | null): boolean {
  return role === "Admin" || role === "Sales" || role === "CRM";
}

/** Only admins may archive, restore or permanently delete. */
export function canArchive(role?: string | null): boolean {
  return role === "Admin";
}

/** Admin-only surfaces: team management, the dashboard logo, marketing spend. */
export function isAdmin(role?: string | null): boolean {
  return role === "Admin";
}

/**
 * Restricts a client query to the signed-in user's own book.
 *
 * Admin keeps the company-wide view; everyone else only sees clients where they
 * are the 1st or 2nd contact. Returns `undefined` for admins so the caller can
 * spread it into a filter object without overriding an explicit `assignee`.
 *
 * Caveat: Client stores contacts as free-text display names, not user ids, so
 * this matches on name. Renaming a user would orphan their clients — the real
 * fix is a salespersonUsername column.
 */
export function assigneeScope(user: SessionUser | null): string | undefined {
  if (!user) return undefined;
  return user.role === "Admin" ? undefined : user.name;
}

export const SESSION_COOKIE = "rwaq_session";
export const SESSION_PREFIX = "rwaq-session-";
export const DEMO_SESSION = "rwaq-demo-session";

/** Cookie value for a given username. */
export const sessionCookieValue = (username: string) =>
  `${SESSION_PREFIX}${String(username).toLowerCase()}`;

/** Normalize any stored role value into one of the supported roles. */
export function normalizeRole(role?: string, username?: string): Role {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "admin") return "Admin";
  if (r === "sales") return "Sales";
  if (r === "crm") return "CRM";
  if (r === "visitor" || r === "viewer" || r === "readonly") return "Visitor";
  if (r === "member") return "Sales";
  // The workspace owner always keeps full privileges.
  if (String(username ?? "").trim().toLowerCase() === "moustafa") return "Admin";
  return "Sales";
}

export type SessionUser = { username?: string; name: string; initials: string; role: Role; email?: string };

export async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return false;
  if (session === DEMO_SESSION) return true;
  if (session.startsWith(SESSION_PREFIX)) {
    const username = session.slice(SESSION_PREFIX.length);
    try {
      return Boolean(await findUser(username));
    } catch {
      // Fail closed if the database is unreachable.
      return false;
    }
  }
  return false;
}

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session === DEMO_SESSION) {
    return { username: "amira", name: "Amira Mansour", initials: "AM", role: "Admin", email: "demo@rwaq.app" };
  }
  if (session?.startsWith(SESSION_PREFIX)) {
    const username = session.slice(SESSION_PREFIX.length);
    try {
      const user = await findUser(username);
      if (!user) return null;
      return {
        username: user.username,
        name: user.name,
        initials: user.name.slice(0, 2).toUpperCase(),
        role: normalizeRole(user.role, user.username),
        email: user.email,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export async function requireRole(request: NextRequest, roles: Role[]): Promise<SessionUser | null> {
  const user = await getSessionUser(request);
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** Shape of the session cookie to set on a successful login. */
export const sessionCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 8,
  path: "/",
};

