import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, readSettingObject, readSettingValue } from "@/lib/db";
import { STATUS_LABELS_SETTING_KEY, coerceStatusLabels, stageFallback } from "@/lib/reporting";
import { buildWorkbook, dateStamp, xlsxResponse, type ExcelColumn } from "@/lib/excel";

/**
 * Activity-log export: every timeline entry across the book, as a spreadsheet.
 *
 * Each client's timeline is only readable one client at a time, so there is no
 * way to answer "what happened across my book this week?" or "what did this rep
 * change last month?" — which is exactly what an audit trail is for. This
 * flattens every `activityLog` into one row per entry.
 *
 * Admin-only, for the same reason the workspace backup is: a timeline is the
 * record of who did what to whose data. A rep's own feed is already on the
 * clients screen; exporting the WHOLE book's history is a management/audit act,
 * not a daily one.
 *
 * Reuses the clients export's filter vocabulary (`q`, `from`, `to`, `statuses`,
 * `firstContacts`) so "export the activity for what I am looking at" means the
 * same thing in both places — except that the date range filters the ENTRY date
 * here, since "activity last week" is the question this route exists for.
 */

const COLUMNS: ExcelColumn[] = [
  { header: "When", key: "when", width: 19 },
  { header: "Client ID", key: "clientId", width: 12 },
  { header: "Client", key: "client", width: 24 },
  { header: "Phone", key: "phone", width: 16 },
  { header: "Owner", key: "owner", width: 16 },
  { header: "Client status", key: "status", width: 14 },
  { header: "Action", key: "action", width: 18 },
  { header: "Field", key: "field", width: 18 },
  { header: "From", key: "from", width: 26 },
  { header: "To", key: "to", width: 26 },
  { header: "Actor", key: "actor", width: 16 },
  { header: "Archived", key: "archived", width: 10 },
];

/**
 * Why the ACTION column holds a token rather than a label.
 *
 * The clients export writes DISPLAY labels because a human reads that sheet.
 * This one writes the stored TOKEN, because a log is data another tool reads: a
 * token never changes when the app is translated or a status is renamed, so a
 * diff between two exports stays meaningful — the same reason activity rows are
 * stored as tokens rather than prose in the first place. Unknown tokens are
 * passed through rather than dropped, so a row is never silently lost.
 */

const list = (value: string | null): string[] =>
  (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);

const day = (value: string): string => value.slice(0, 10);

const norm = (value: string): string => value.replace(/[\s\-().]/g, "").toLowerCase();

/** One timeline entry, flattened. Mirrors `ActivityEntry` in src/lib/types.ts. */
type Entry = {
  timestamp?: string;
  actor?: string;
  action?: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  clientName?: string;
};

/** A row as the workbook writer sees it: cells are dates or strings. */
type Row = Record<string, string | Date>;

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  const session = await getSessionUser(request);
  if (!session || session.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams;

  try {
    const statuses = list(q.get("statuses") ?? q.get("status")).map((s) => s.toUpperCase());
    const firstContacts = list(q.get("firstContacts") ?? q.get("firstContact"));
    const query = (q.get("q") ?? "").trim().toLowerCase();
    const from = q.get("from");
    const to = q.get("to");

    const [clients, labels, brand] = await Promise.all([
      // Not scoped to the caller's book: an admin-only workspace-wide audit that
      // silently omitted rows would defeat the point of asking for them.
      listClients({ includeArchived: true }),
      readSettingObject(STATUS_LABELS_SETTING_KEY),
      readSettingValue("brand"),
    ]);
    const statusLabels = coerceStatusLabels(labels);

    const rows: Row[] = [];

    for (const client of clients) {
      if (statuses.length > 0 && !statuses.includes(String(client.status).toUpperCase())) continue;
      if (firstContacts.length > 0 &&
          !firstContacts.some((n) => n.toLowerCase() === String(client.firstContactPerson ?? "").toLowerCase())) {
        continue;
      }
      if (query && !norm(`${client.name} ${client.phoneNumber} ${client.project}`).includes(norm(query))) continue;

      const log = Array.isArray(client.activityLog) ? (client.activityLog as Entry[]) : [];
      for (const entry of log) {
        const when = String(entry.timestamp ?? "");
        if (from && day(when) < from) continue;
        if (to && day(when) > to) continue;
        const action = String(entry.action ?? "");
        rows.push({
          // A real Date, so the column sorts and filters in Excel rather than
          // sorting only by luck as text.
          when: when ? new Date(when) : "",
          clientId: client.id,
          client: client.name,
          phone: client.phoneNumber,
          owner: client.firstContactPerson,
          // The admin's display name for the status, falling back to the token.
          status: statusLabels[String(client.status ?? "")] ?? stageFallback(client.status),
          // Written as stored: an action this build does not know about still
          // has to appear, or the log would silently lose rows.
          action,
          field: entry.field ?? "",
          from: entry.oldValue ?? "",
          to: entry.newValue ?? "",
          actor: entry.actor ?? "",
          archived: client.archived ? "Yes" : "No",
        });
      }
    }

    // Newest first: an audit trail is read from the top.
    rows.sort((a, b) => String(b.when).localeCompare(String(a.when)));

    // White-label: the workspace name rides into the file's author metadata and
    // its filename prefix, exactly as the clients and marketing exports do.
    const name = brand ?? "";
    const buffer = await buildWorkbook(
      [
        {
          name: "Activity log",
          columns: COLUMNS,
          rows,
          // Written as dates, not serial numbers.
          dateColumns: ["when"],
          totalsRow: { clientId: `${rows.length} ${rows.length === 1 ? "entry" : "entries"}` },
        },
      ],
      name,
    );

    const slug = name.trim().toLowerCase().replace(/\s+/g, "-") || "rwaq";
    return xlsxResponse(buffer, `${slug}-activity-log-${dateStamp()}.xlsx`);
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
