import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClientsPaged } from "@/lib/db";
import { assigneeScope } from "@/lib/auth";

/**
 * Typeahead client lookup for the global search palette.
 *
 * A deliberately separate endpoint rather than a mode on /api/crm/clients: the
 * clients routes answer "what does this book contain under these filters", which
 * needs the whole filter vocabulary, a pager and a configurable sort. This one
 * answers a single question — "who did the user just type" — and is on the
 * keystroke path, so it returns a hard-capped handful of rows and nothing else.
 *
 * The match itself is NOT reimplemented here. It reuses the same `search` clause
 * the clients table already searches with (name, project, notes and a
 * punctuation-stripped phone), so typing a number into the palette finds the same
 * rows the table would — a second, subtly different matcher would be a second set
 * of "search says it's not there but it is" bugs.
 */

/** How many rows a keystroke may return. Small enough to feel instant. */
const LIMIT = 8;

/** A shorter query than this returns nothing rather than the whole book. */
const MIN_QUERY = 2;

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY) {
    return NextResponse.json({ query: q, results: [], total: 0 });
  }

  try {
    const session = await getSessionUser(request);
    /* Scoped exactly like every other client read, and for the same reason: a
       palette that searches the whole company would leak colleagues' clients to
       a rep who cannot otherwise see them. An Admin still searches everything. */
    const requested = (request.nextUrl.searchParams.get("assignee") ?? "").trim();
    const assignee = requested || assigneeScope(session);

    const page = await listClientsPaged(
      { search: q, assignee },
      { page: 1, pageSize: LIMIT, sort: "recent" },
    );

    return NextResponse.json({
      query: q,
      // `total` is the server's COUNT, so the palette can say "12 matches, showing
      // the first 8" instead of implying the list is complete.
      total: page.total,
      results: page.rows.map((c) => ({
        id: c.id,
        name: c.name,
        phoneNumber: c.phoneNumber,
        status: c.status,
        project: c.project,
        location: c.location,
        firstContactPerson: c.firstContactPerson,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}