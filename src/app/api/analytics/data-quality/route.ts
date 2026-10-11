import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, readSetting } from "@/lib/db";

/**
 * Data-quality report over the clients book.
 *
 * Answers the question the clients table cannot: "which rows are incomplete or
 * wrong?" A book of a few hundred rows always has some with no phone, a phone
 * that is really a note, no owner, or a free-typed channel that never made it
 * into the reference list. Those rows are invisible until someone tries to call
 * them.
 *
 * Deliberately a REPORT, not a repair: nothing here writes. Every check reads
 * data the app already stores and already shows, so a row flagged here would
 * look wrong on the clients screen too — there is no separate notion of "valid"
 * that only this endpoint knows about.
 *
 * Scoped like every other read: a Sales/CRM user sees their own book.
 */

/** One problem found on one row. */
export type Issue = {
  clientId: string;
  name: string;
  /** The check that failed; the UI localizes it. */
  kind: IssueKind;
  /** What was actually stored, so the user can judge it without opening the row. */
  detail: string;
};

export type IssueKind =
  | "no_name"
  | "no_phone"
  | "bad_phone"
  | "no_owner"
  | "no_project"
  | "no_location"
  | "no_next_action"
  | "unknown_channel"
  | "unknown_status";

/** A phone with fewer than this many digits cannot be dialled. */
const MIN_PHONE_DIGITS = 7;

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  try {
    const session = await getSessionUser(request);
    if (!session) return unauthorized();

    const scope = assigneeScope(session);
    const [clients, channels, statuses] = await Promise.all([
      listClients({ includeArchived: true, assignee: scope }),
      readSetting("channels"),
      readSetting("statuses"),
    ]);

    const knownChannels = new Set(channels.map((c) => c.trim().toLowerCase()));
    const knownStatuses = new Set(statuses.map((s) => s.trim().toLowerCase()));

    const issues: Issue[] = [];

    for (const client of clients) {
      /* Archived rows are excluded on purpose: an archived lead is a decision
         already taken, and flagging its gaps would bury the live problems. */
      if (client.archived) continue;

      const push = (kind: IssueKind, detail: string) =>
        issues.push({ clientId: client.id, name: client.name, kind, detail });

      const name = String(client.name ?? "").trim();
      const phone = String(client.phoneNumber ?? "").trim();

      if (!name) push("no_name", "");
      /* No phone at all, or a phone that is really prose ("عبر المبيعات"). Both
         block a call, so they are separate kinds: one needs data entry, the
         other needs a decision about what that text means. */
      if (!phone) push("no_phone", "");
      else if (phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) push("bad_phone", phone);

      if (!String(client.firstContactPerson ?? "").trim()) push("no_owner", "");
      if (!String(client.project ?? "").trim()) push("no_project", "");
      if (!String(client.location ?? "").trim()) push("no_location", "");
      if (!String(client.operationToTake ?? "").trim()) push("no_next_action", "");

      const channel = String(client.acquisitionChannel ?? "").trim();
      /* A channel the reference list does not know about is not selectable in
         the filter, so its clients are unreachable from there. */
      if (channel && !knownChannels.has(channel.toLowerCase())) push("unknown_channel", channel);

      const status = String(client.status ?? "").trim();
      if (status && !knownStatuses.has(status.toLowerCase())) push("unknown_status", status);
    }

    // Grouped by kind with a sample per group, so the panel is actionable
    // without shipping every offending row.
    const byKind = new Map<IssueKind, Issue[]>();
    for (const issue of issues) {
      const list = byKind.get(issue.kind);
      if (list) list.push(issue);
      else byKind.set(issue.kind, [issue]);
    }

    const groups = [...byKind.entries()]
      .map(([kind, list]) => ({
        kind,
        count: list.length,
        // Capped for payload size; the count above stays exact.
        sample: list.slice(0, 25),
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      issues: groups,
      total: issues.length,
      /* Distinct rows affected, so "12 problems" is never confused with "12
         rows" — one row can fail several checks. */
      clientCount: new Set(issues.map((i) => i.clientId)).size,
      scanned: clients.filter((c) => !c.archived).length,
      source: "postgres",
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
