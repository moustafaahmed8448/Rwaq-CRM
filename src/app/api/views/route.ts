import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, mutateSavedViews, readSavedViews } from "@/lib/db";
import type { SavedView, SavedViewFilters } from "@/lib/db";

/**
 * Per-user saved filter views for the clients screen.
 *
 * Strictly self-service: the list is keyed by the SESSION user, never by anything
 * in the body, so one user can neither read nor overwrite another's saved views
 * however the request is crafted. There is deliberately no admin route that reads
 * someone else's — a saved view is a personal way of looking at the book, not
 * shared workspace configuration.
 */
async function currentUsername(request: NextRequest): Promise<string | null> {
  const user = await getSessionUser(request);
  // The built-in demo account has no AppUser row and so nowhere to persist to.
  if (!user?.username || user.username === "amira") return null;
  return user.username;
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const username = await currentUsername(request);
  if (!username) {
    return NextResponse.json({ error: "Demo session cannot save views" }, { status: 400 });
  }
  try {
    return NextResponse.json({ views: await readSavedViews(username) });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const username = await currentUsername(request);
  if (!username) {
    return NextResponse.json({ error: "Demo session cannot save views" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (name.length < 1) return NextResponse.json({ error: "View name required" }, { status: 400 });
  if (!body.filters || typeof body.filters !== "object") {
    return NextResponse.json({ error: "No filters provided" }, { status: 400 });
  }

  // Handed to coerceSavedView on the way out, so a junk filter shape is dropped
  // rather than persisted and restored into live state later.
  const filters = body.filters as SavedViewFilters;

  try {
    const views = await mutateSavedViews(username, (current) => {
      // Re-saving under an existing name replaces that view instead of filling the
      // list with near-duplicates — the behaviour a "save view" button is expected
      // to have when the name is already taken.
      const kept = current.filter((v) => v.name.toLowerCase() !== name.toLowerCase());
      const view: SavedView = {
        id: current.find((v) => v.name.toLowerCase() === name.toLowerCase())?.id ?? crypto.randomUUID(),
        name,
        filters,
        createdAt: new Date().toISOString(),
      };
      return [...kept, view];
    });
    return NextResponse.json({ ok: true, views });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const username = await currentUsername(request);
  if (!username) {
    return NextResponse.json({ error: "Demo session cannot save views" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "View id required" }, { status: 400 });

  try {
    const views = await mutateSavedViews(username, (current) => current.filter((v) => v.id !== id));
    return NextResponse.json({ ok: true, views });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}