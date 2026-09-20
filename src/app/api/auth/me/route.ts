import { NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION, SESSION_COOKIE, normalizeRole } from "@/lib/auth";
import { findUser } from "@/lib/db";
import { ensureUsersBootstrapped } from "@/lib/bootstrap";

export async function GET(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });

  // Built-in demo user
  if (session === DEMO_SESSION) {
    return NextResponse.json({
      authenticated: true,
      user: { name: "Amira Mansour", initials: "AM", role: "Admin", email: "demo@rwaq.app" },
    });
  }

  if (session.startsWith("rwaq-session-")) {
    const username = session.slice("rwaq-session-".length);
    try {
      await ensureUsersBootstrapped();
      const user = await findUser(username);
      if (user) {
        return NextResponse.json({
          authenticated: true,
          user: {
            name: user.name,
            initials: user.name.slice(0, 2).toUpperCase(),
            role: normalizeRole(user.role, user.username),
            email: user.email ?? "",
          },
        });
      }
    } catch {
      // Fall through to unauthenticated.
    }
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}
