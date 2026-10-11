import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listUsers, readSettingObject } from "@/lib/db";
import { BUCKETS_SETTING_KEY, classifyStatusWith, coerceStatusBuckets } from "@/lib/reporting";

/**
 * Per-owner performance over the clients book.
 *
 * The weekly analytics route answers "which CHANNEL works"; this answers "WHO is
 * carrying the book". Nothing else in the app joins a client to its owner and
 * then counts, so an admin had no way to see that one rep owns 200 live leads
 * while another owns 12 â€” the imbalance that makes follow-ups get missed.
 *
 * Deliberately built from `listClients` + `listUsers` rather than new queries:
 * the ownership rule (`firstContactPerson`, exact match) and the scoping rule
 * (`assigneeScope`) are the same ones every other screen uses, so these numbers
 * cannot disagree with the clients table. `classifyStatusWith` is what the funnel
 * uses too, so an admin's status-bucket choice is honoured here as well.
 *
 * Read-only and scoped: a Sales/CRM user gets their OWN row only. Admin and
 * Visitor see the whole team.
 */

/** A single owner's line in the report. */
type OwnerRow = {
  name: string;
  /** Role from the roster, or "" for an owner who is not on it. */
  role: string;
  /** False when the name is on a client but not on the roster (a leaver, or free text). */
  active: boolean;
  total: number;
  won: number;
  lost: number;
  inProgress: number;
  /** Live rows that are neither won nor lost â€” the work still in hand. */
  open: number;
  archived: number;
  overdueFollowUps: number;
  dueFollowUps: number;
  /** Won / (won + lost) as a whole percent. No closed deals reads as 0, not NaN. */
  winRate: number;
  /** The oldest last-update among this owner's live clients, if any. */
  lastTouch: string | null;
};

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  try {
    const session = await getSessionUser(request);
    if (!session) return unauthorized();

    const scope = assigneeScope(session);
    const [clients, users, bucketsRaw] = await Promise.all([
      listClients({ includeArchived: true, assignee: scope }),
      listUsers(),
      readSettingObject(BUCKETS_SETTING_KEY),
    ]);
    const buckets = coerceStatusBuckets(bucketsRaw);

    const byOwner = new Map<string, OwnerRow>();
    const now = Date.now();

    const rowFor = (name: string): OwnerRow => {
      const existing = byOwner.get(name);
      if (existing) return existing;
      // Seeded from the roster so a rep with an empty book still appears: "0
      // leads" is the actionable fact, and omitting the row hides it.
      const user = users.find((u) => u.name === name);
      const row: OwnerRow = {
        name,
        role: user?.role ?? "",
        active: Boolean(user),
        total: 0, won: 0, lost: 0, inProgress: 0, open: 0, archived: 0,
        overdueFollowUps: 0, dueFollowUps: 0, winRate: 0, lastTouch: null,
      };
      byOwner.set(name, row);
      return row;
    };

    for (const client of clients) {
      // Ownership is the 1st contact, the same field the clients table, the
      // export and the reassignment endpoint treat as the owner.
      const owner = String(client.firstContactPerson ?? "").trim();
      if (!owner) continue;
      const row = rowFor(owner);
      row.total += 1;

      if (client.archived) {
        row.archived += 1;
        continue;
      }

      // Same classifier the funnel and the KPI cards use, so a rep's "won" here
      // is the same "won" everywhere else in the app.
      const outcome = classifyStatusWith(String(client.status ?? ""), buckets);
      if (outcome === "won") row.won += 1;
      else if (outcome === "lost") row.lost += 1;
      else if (outcome === "progress") row.inProgress += 1;
      else row.open += 1;

      // Follow-up pressure: overdue is strictly before now, due is from now on.
      const due = client.nextFollowUpAt ? new Date(client.nextFollowUpAt).getTime() : null;
      if (due !== null) {
        if (due < now) row.overdueFollowUps += 1;
        else row.dueFollowUps += 1;
      }

      // Oldest live touch, so "who has gone quiet" is answerable at a glance.
      const updated = client.lastUpdateDate ? new Date(client.lastUpdateDate).getTime() : 0;
      if (updated && (!row.lastTouch || updated < new Date(row.lastTouch).getTime())) {
        row.lastTouch = new Date(updated).toISOString();
      }
    }

    const rows = [...byOwner.values()].map((row) => {
      // Win rate over CLOSED deals only: counting open leads in the denominator
      // would punish whoever carries the biggest pipeline, which is backwards.
      const closed = row.won + row.lost;
      return { ...row, winRate: closed > 0 ? Math.round((row.won / closed) * 100) : 0 };
    });

    // Busiest owner first â€” the imbalance is the point of the report.
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return NextResponse.json({
      owners: rows,
      source: "postgres",
      // Echoed so the UI can say whether it is looking at one rep or the team.
      scope: scope ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
