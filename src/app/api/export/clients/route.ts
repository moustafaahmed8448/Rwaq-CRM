import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients } from "@/lib/db";
import { parseChannel } from "@/lib/reporting";
import { buildWorkbook, dateStamp, xlsxResponse, type ExcelColumn } from "@/lib/excel";

const CH_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", X: "X", TIKTOK: "TikTok",
  GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", CALLS: "Calls", SALES: "Sales",
};

const STATUS_LABELS: Record<string, string> = { WAITING: "Waiting", WON: "Won", LOST: "Lost" };

const COLUMNS: ExcelColumn[] = [
  { header: "Client ID", key: "clientId", width: 38 },
  { header: "Created", key: "created", width: 13 },
  { header: "Name", key: "name", width: 24 },
  { header: "Phone", key: "phone", width: 18 },
  { header: "Status", key: "status", width: 12 },
  { header: "Project", key: "project", width: 22 },
  { header: "Location", key: "location", width: 18 },
  { header: "Channel", key: "channel", width: 14 },
  { header: "Operation To Take", key: "operation", width: 28 },
  { header: "1st Contact", key: "first", width: 16 },
  { header: "2nd Contact", key: "second", width: 16 },
  { header: "Notes", key: "notes", width: 36 },
  { header: "Last Updated", key: "updated", width: 13 },
  { header: "Archived", key: "archived", width: 10 },
];

const list = (value: string | null): string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const day = (value: string | undefined) => (value ?? "").slice(0, 10);

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  const q = request.nextUrl.searchParams;

  try {
    // The dashboard filters are multi-select, so filter in JS to match the UI
    // semantics exactly (including the date range and free-text query).
    const statuses = list(q.get("statuses") ?? q.get("status")).map((s) => s.toUpperCase());
    const channels = list(q.get("channels") ?? q.get("channel")).map(
      (c) => parseChannel(c) ?? c.toUpperCase(),
    );
    const locations = list(q.get("locations") ?? q.get("location")).map((l) => l.toLowerCase());
    const salespeople = list(q.get("salespeople") ?? q.get("salesperson")).map((s) => s.toLowerCase());
    const ids = list(q.get("ids"));
    const query = (q.get("q") ?? "").trim().toLowerCase();
    const from = day(q.get("from") ?? undefined);
    const to = day(q.get("to") ?? undefined);
    const archivedOnly = q.get("archived") === "1";
    const includeArchived = q.get("includeArchived") === "1";

    const all = await listClients({ includeArchived: true });
    let rows = all;

    if (archivedOnly) rows = rows.filter((c) => c.archived);
    else if (!includeArchived) rows = rows.filter((c) => !c.archived);

    if (statuses.length > 0)
      rows = rows.filter((c) => statuses.includes(String(c.status).toUpperCase()));
    if (channels.length > 0)
      rows = rows.filter((c) => channels.includes(String(c.acquisitionChannel).toUpperCase()));
    if (locations.length > 0)
      rows = rows.filter((c) => locations.includes(c.location.toLowerCase()));
    if (salespeople.length > 0)
      rows = rows.filter(
        (c) =>
          salespeople.includes(c.firstContactPerson.toLowerCase()) ||
          salespeople.includes(c.secondContactPerson.toLowerCase()),
      );
    if (from) rows = rows.filter((c) => day(c.createdAt) >= from);
    if (to) rows = rows.filter((c) => day(c.createdAt) <= to);
    if (query) {
      // Same space-insensitive matching as the dashboard, so the exported
      // filtered view matches what the user sees (phone numbers with or
      // without spaces/dashes).
      const norm = (s: string) => s.replace(/[\s\-().]/g, "").toLowerCase();
      rows = rows.filter((c) =>
        norm(`${c.name} ${c.phoneNumber} ${c.project} ${c.notes ?? ""}`).includes(norm(query)),
      );
    }
    if (ids.length > 0) {
      const wanted = new Set(ids);
      rows = rows.filter((c) => wanted.has(c.id));
    }

    const sheetRows = rows.map((c) => ({
      clientId: c.id,
      created: day(c.createdAt),
      name: c.name,
      phone: c.phoneNumber,
      status: STATUS_LABELS[c.status] ?? c.status,
      project: c.project,
      location: c.location,
      channel: CH_LABELS[c.acquisitionChannel] ?? c.acquisitionChannel,
      operation: c.operationToTake,
      first: c.firstContactPerson,
      second: c.secondContactPerson,
      notes: c.notes ?? "",
      updated: day(c.lastUpdateDate),
      archived: c.archived ? "Yes" : "No",
    }));

    const scope = ids.length > 0 ? "selected" : "all";
    const buffer = await buildWorkbook([
      {
        name: ids.length > 0 ? "Selected clients" : "Clients",
        columns: COLUMNS,
        rows: sheetRows,
        totalsRow: { clientId: `${sheetRows.length} client${sheetRows.length === 1 ? "" : "s"}` },
      },
    ]);

    return xlsxResponse(buffer, `rwaq-clients-${scope}-${dateStamp()}.xlsx`);
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
