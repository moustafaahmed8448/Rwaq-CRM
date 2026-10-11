import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { bulkUpdateClients, databaseErrorMessage, listClients, listUsers } from "@/lib/db";

/**
 * Bulk owner reassignment: `{ ids, firstContactPerson?, secondContactPerson?,
 * operationToTake? }`.
 *
 * This deliberately lives OUTSIDE the generic `{ ids, ...fields }` PATCH on
 * /api/crm/clients. That endpoint will happily write any owner name into the
 * contact columns, which means a wrong click can hand the whole book to a
 * person who does not exist — and then no notification ever arrives, because
 * there is no matching user to notify. This route closes both gaps:
 *
 *   1. Owner names are validated against the CURRENT AppUser roster before
 *      anything is written, so an unknown name is a 400, not a silent orphan.
 *   2. Visitor is rejected outright (canWrite), and a non-Admin may only
 *      reassign clients inside their OWN book — the same boundary
 *      `assigneeScope` enforces on reads, so bulk reassignment cannot become a
 *      write-side bypass of the per-rep view.
 *
 * `operationToTake` is accepted alongside the owners because a hand-over is
 * usually accompanied by "here is what to do next"; it rides the same
 * transaction rather than needing a second request.
 *
 * The timeline entries (FIELD_EDIT per changed column) and the notifications
 * (ASSIGNED to the new owner) come from `bulkUpdateClients` → `updateClient`,
 * so bulk and single edits record and announce identically.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  // Visitor is read-only everywhere; this endpoint is a write.
  if (!canWrite(user.role)) return NextResponse.json({ error: "Read-only role" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  // Explicitly typed end-to-end: without the `unknown[]` annotation the guard
  // below runs on `any[]` and the narrowed `ids` type collapses, failing every
  // downstream call that expects `string[]`.
  const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : [];
  const ids: string[] = [...new Set(
    rawIds
      .filter((id): id is string => typeof id === "string" && id.trim() !== "")
      .map((id) => id.trim()),
  )];
  if (ids.length === 0) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const first = typeof body.firstContactPerson === "string" ? body.firstContactPerson.trim() : undefined;
  const second = typeof body.secondContactPerson === "string" ? body.secondContactPerson.trim() : undefined;
  const operation = typeof body.operationToTake === "string" ? body.operationToTake.trim() : undefined;
  if (first === undefined && second === undefined && operation === undefined) {
    return NextResponse.json({ error: "Nothing to reassign" }, { status: 400 });
  }

  try {
    // 1. Roster check. An empty string is a legitimate value — it UNASSIGNS the
    //    contact — so only non-empty names must exist in the team.
    const roster = new Set((await listUsers()).map((u) => u.name.trim().toLowerCase()));
    const requested = [first, second].filter((n): n is string => Boolean(n));
    const unknown = requested.filter((n) => !roster.has(n.toLowerCase()));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "Unknown owner name", unknown },
        { status: 400 },
      );
    }

    // 2. Cross-book check for non-admins: only clients already in the caller's
    //    book may change hands. Admin sees (and may move) everything, matching
    //    assigneeScope exactly.
    if (user.role !== "Admin") {
      const book = new Set(
        (await listClients({ includeArchived: true, assignee: assigneeScope(user) })).map((c) => c.id),
      );
      const foreign = ids.filter((id) => !book.has(id));
      if (foreign.length > 0) {
        return NextResponse.json(
          { error: "You can only reassign clients in your own book", foreign },
          { status: 403 },
        );
      }
    }

    const patch: Record<string, string> = {};
    if (first !== undefined) patch.firstContactPerson = first;
    if (second !== undefined) patch.secondContactPerson = second;
    if (operation !== undefined) patch.operationToTake = operation;

    const result = await bulkUpdateClients(ids, patch, user.name);
    return NextResponse.json({
      source: "postgres",
      ...result,
      requested: ids.length,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}