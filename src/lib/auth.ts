import { NextRequest, NextResponse } from "next/server";
import { findUser } from "./db";

/**
 * Session handling. Users live in Postgres (AppUser); this module is async
 * because every lookup hits the database. All call sites must `await`.
 */

export type Role = "Admin" | "Sales" | "CRM";
export const ROLES: Role[] = ["Admin", "Sales", "CRM"];

export const SESSION_COOKIE = "rwaq_session";
const SESSION_PREFIX = "rwaq-session-";
export const DEMO_SESSION = "rwaq-demo-session";

/** Cookie value for a given username. */
export const sessionCookieValue = (username: string) =>
  `${SESSION_PREFIX}${String(username).toLowerCase()}`;

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

