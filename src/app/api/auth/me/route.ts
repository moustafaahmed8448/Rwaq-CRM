import { NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION, SESSION_COOKIE, normalizeRole } from "@/lib/auth";
import { databaseErrorMessage, findUser, saveUserColumnPrefs } from "@/lib/db";
import { ensureUsersBootstrapped } from "@/lib/bootstrap";

export async function GET(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });

  // Built-in demo user
  if (session === DEMO_SESSION) {
    return NextResponse.json({
      authenticated: true,
      user: { name: "Amira Mansour", initials: "AM", role: "Admin", email: "demo@rwaq.app", language: "ar" },
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
            language: user.language,
            // Saved clients-table layout. Sparse; the client fills the gaps from
            // the registry defaults (see resolveColumns).
            clientColumns: user.clientColumns ?? {},
          },
        });
      }
    } catch {
      // Fall through to unauthenticated.
    }
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}

/**
 * Saves the signed-in user's own clients-table layout.
 *
 * Self-service on purpose: this is a personal view preference, so it must NOT go
 * through /api/users PATCH, which is Admin-only. Any authenticated user edits
 * only their own row — the username comes from the session cookie, never from
 * the body, so one user cannot write another's layout.
 */
export async function PATCH(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The built-in demo account has no AppUser row, so there is nowhere to save.
  if (session === DEMO_SESSION) {
    return NextResponse.json({ error: "Demo session cannot save preferences" }, { status: 400 });
  }
  if (!session.startsWith("rwaq-session-")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const username = session.slice("rwaq-session-".length);
  const body = await request.json().catch(() => ({}));
  try {
    const saved = await saveUserColumnPrefs(username, body.clientColumns);
    return NextResponse.json({ ok: true, clientColumns: saved });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
