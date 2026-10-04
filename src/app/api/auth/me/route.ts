import { NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION, SESSION_COOKIE, SESSION_PREFIX, normalizeRole } from "@/lib/auth";
import { databaseErrorMessage, findUser, saveUserColumnPrefs, updateUser } from "@/lib/db";
import { readAvatar } from "@/lib/avatar-payload";
import type { ColumnPrefs } from "@/lib/client-columns";
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
            // The signed-in user's OWN photo. It was missing here, which is why
            // the header and /profile could never show it: they had no
            // DB-backed source at all and fell back to reading the same data-URL
            // out of this browser's localStorage. Now the account avatar lives in
            // one place and follows the user between machines.
            avatar: user.avatar ?? "",
            // Saved table layouts. Sparse; each fills its gaps from the registry
            // defaults (see resolveColumns).
            clientColumns: user.clientColumns ?? {},
            marketingColumns: user.marketingColumns ?? {},
            userColumns: user.userColumns ?? {},
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
 * Saves the signed-in user's own table layout(s) and/or profile photo.
 *
 * Self-service on purpose: these are personal view preferences and your own
 * picture, so they must NOT go through /api/users PATCH, which is Admin-only.
 * Any authenticated user edits only their own row — the username comes from the
 * session cookie, never from the body, so one user cannot write another's layout
 * or photo.
 *
 * Accepts EITHER blob in one call and writes only the ones present, so a single
 * request can carry both layouts without the route growing a branch per table.
 * `undefined` means "leave untouched" rather than "clear" — a caller that only
 * knows about the clients table cannot blank the marketing one by omission.
 *
 * The photo was the missing piece: /settings used to save it to localStorage and
 * nowhere else, so it never reached the database and no other screen could show
 * it. This is that write. The response echoes the STORED value rather than
 * echoing back what was sent, so the client can trust the server's copy.
 */
export async function PATCH(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The built-in demo account has no AppUser row, so there is nowhere to save.
  if (session === DEMO_SESSION) {
    return NextResponse.json({ error: "Demo session cannot save preferences" }, { status: 400 });
  }
  if (!session.startsWith(SESSION_PREFIX)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const username = session.slice(SESSION_PREFIX.length);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const saved: Record<string, ColumnPrefs> = {};
    if (body.clientColumns !== undefined) {
      saved.clientColumns = await saveUserColumnPrefs(username, "clientColumns", body.clientColumns);
    }
    if (body.marketingColumns !== undefined) {
      saved.marketingColumns = await saveUserColumnPrefs(username, "marketingColumns", body.marketingColumns);
    }
    if (body.userColumns !== undefined) {
      saved.userColumns = await saveUserColumnPrefs(username, "userColumns", body.userColumns);
    }

    // `null` clears the photo, a PNG data URL stores it, and `undefined` means the
    // key was absent OR the payload was junk. Rejecting junk out loud matters: a
    // silently ignored save looks identical to a successful one, which is how the
    // localStorage-only upload went unnoticed for so long.
    let avatar: string | null | undefined;
    if (body.avatar !== undefined) {
      const read = readAvatar(body.avatar);
      if (read === undefined) {
        return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
      }
      avatar = read;
    }
    if (avatar !== undefined) {
      const updated = await updateUser(username, { avatar });
      // Report what is actually stored. A null here means the row went away.
      avatar = updated ? (updated.avatar ?? null) : null;
    }

    /* Checks all THREE fields. It used to test only the first two, so a request
       carrying just `userColumns` — every save from the /users table — passed
       through `saveUserColumnPrefs` below and was then rejected with "No layout
       provided" 400, even though the write had already succeeded. */
    if (
      saved.clientColumns === undefined &&
      saved.marketingColumns === undefined &&
      saved.userColumns === undefined &&
      avatar === undefined
    ) {
      return NextResponse.json({ error: "No layout provided" }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      ...saved,
      ...(avatar !== undefined ? { avatar } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
