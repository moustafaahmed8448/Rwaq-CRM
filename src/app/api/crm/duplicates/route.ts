import { NextRequest, NextResponse } from "next/server";
import { isAdmin, canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, findDuplicates, mergeClients } from "@/lib/db";

/**
 * Duplicate detection and merge for the clients book.
 *
 * The two verbs have DIFFERENT gates, by design:
 *
 *   GET (detect) — open to every write-capable role (Admin, Sales, CRM).
 *     Detecting is a report; a rep may review potential duplicates even if they
 *     cannot merge them.
 *
 *   POST (merge) — Admin only. A merge archives source rows and rewrites the
 *     survivor, so it is the same privilege class as archiving / deleting.
 */
/** Write-capable roles (Admin, Sales, CRM) — may view duplicate groups. */
async function requireCanWrite(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session || !canWrite(session.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return session;
}

/** Admin only — may merge (archive) duplicate records. */
async function requireAdminOnly(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session || !isAdmin(session.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return session;
}

/** GET — the groups, strongest signal first. */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const session = await requireCanWrite(request);
  if (session instanceof NextResponse) return session;

  try {
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    const groups = await findDuplicates(includeArchived);
    /* Phone groups are the confident ones, so they lead. Within a reason, larger
       groups first: a triple is more work to leave in place than a pair. */
    groups.sort((a, b) => {
      if (a.reason !== b.reason) return a.reason === "phone" ? -1 : 1;
      return b.clients.length - a.clients.length;
    });
    return NextResponse.json({
      groups,
      // A count of rows involved, not of groups: "12 duplicates" is ambiguous
      // between the two, so both are named explicitly.
      groupCount: groups.length,
      clientCount: groups.reduce((sum, g) => sum + g.clients.length, 0),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST — merge a group into one surviving row.
 *
 * `primaryId` is honoured as given rather than being decided server-side, because
 * the UI shows the merged result and the user may have chosen the OTHER row to
 * keep. Re-deciding it here would silently discard their choice.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const session = await requireAdminOnly(request);
  if (session instanceof NextResponse) return session;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const primaryId = String(body.primaryId ?? "").trim();
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.map((s) => String(s ?? "")).filter(Boolean)
    : [];

  if (!primaryId) return NextResponse.json({ error: "Primary client required" }, { status: 400 });
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: "No clients to merge" }, { status: 400 });
  }
  /* A group is by definition a handful of rows. The cap stops a hand-crafted
     request from turning one call into a full-book rewrite. */
  if (sourceIds.length > 50) {
    return NextResponse.json({ error: "Too many clients in one merge" }, { status: 400 });
  }

  try {
    const result = await mergeClients(primaryId, sourceIds, session.name ?? "Admin");
    /* Null here means the survivor or one of the sources did not exist. That is a
       404 and NOT a silent no-op: the caller must not render "merged" when the
       database changed nothing. */
    if (!result) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}