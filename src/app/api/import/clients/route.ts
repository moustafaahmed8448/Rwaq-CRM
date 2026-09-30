import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import {
  addSettingValues,
  bulkImportClients,
  databaseErrorMessage,
  listImportBaseline,
  readSetting,
  recordSyncRun,
  updateClient,
} from "@/lib/db";
import { fetchSheetRows, sheetUrl, SheetError } from "@/lib/google-sheet";
import { applySelection, buildImportPlan, type RowSelection } from "@/lib/import-clients";

/**
 * Imports client leads from the public Google Sheet.
 *
 * Two modes, one planner:
 *   preview — read-only; reports exactly what a commit would do
 *   commit  — performs the write
 *
 * Both call `buildImportPlan`, so the preview can never describe something
 * different from what the commit actually does.
 *
 * Admin-only, deliberately. An import writes hundreds of clients AND appends to
 * the shared status/channel/location reference lists, so it is workspace-wide
 * reference data, exactly like removing a channel (see /api/channels DELETE).
 * Letting a Sales rep run it would let one user reshape shared reference data
 * for everyone.
 */

const PROVIDER = "google-sheets";

/** Error strings surfaced to the browser; registered in api-errors.ts. */
const ERR_ADMIN = "Only admins can import clients";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Reference values + stored clients, all read in one round trip. */
async function loadContext() {
  const [statuses, channels, locations, baseline] = await Promise.all([
    readSetting("statuses"),
    readSetting("channels"),
    readSetting("locations"),
    listImportBaseline(),
  ]);
  return { refs: { statuses, channels, locations }, baseline };
}

/** The preview payload, shared by both modes so the UI renders one shape. */
function summarize(plan: ReturnType<typeof buildImportPlan>, mode: "preview" | "commit") {
  const count = (kind: string): number => plan.diff.filter((r) => r.kind === kind).length;
  return {
    mode,
    source: sheetUrl(),
    toCreate: plan.drafts.length,
    toUpdate: count("changed"),
    identical: count("identical"),
    skipped: plan.skipped.length,
    skippedByReason: plan.skipped.reduce<Record<string, number>>((acc, row) => {
      acc[row.reason] = (acc[row.reason] ?? 0) + 1;
      return acc;
    }, {}),
    // Only creates carry a date, so this counts the new rows that have none.
    dateAssumed: plan.drafts.filter((d) => d.dateAssumed).length,
    newStatuses: plan.newStatuses,
    newChannels: plan.newChannels,
    newLocations: plan.newLocations,
    statusMapping: plan.statusMapping,
    repairedRows: plan.repairedRows,
    // Capped so a 300-row skip list cannot bloat the response; the counts above
    // stay exact. The first entries are shown so the user can spot a pattern.
    skippedSample: plan.skipped.slice(0, 25),
    diff: plan.diff,
    dbOnly: plan.dbOnly,
  };
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  const session = await getSessionUser(request);
  if (!session || session.role !== "Admin") return errorResponse(ERR_ADMIN, 403);

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "commit" ? "commit" : "preview";

  try {
    const rows = await fetchSheetRows();
    const { refs, baseline } = await loadContext();
    const plan = buildImportPlan(rows, refs, baseline);

    if (mode === "preview") {
      return NextResponse.json(summarize(plan, "preview"));
    }

    // The browser sends only WHICH rows to act on and which fields to keep. The
    // plan is rebuilt here from a fresh sheet read, so the client can never name
    // a client id to overwrite, and a sheet that changed since the preview is
    // re-diffed rather than applied blind. `keep` is filtered against
    // SYNCABLE_FIELDS inside applySelection.
    const selection: RowSelection[] = Array.isArray(body.rows)
      ? body.rows.filter(
          (r: unknown): r is RowSelection =>
            typeof r === "object" && r !== null && typeof (r as RowSelection).rowNumber === "number",
        )
      : [];

    const { creates, updates, newStatuses, newChannels, newLocations } =
      applySelection(plan, selection, refs);

    if (creates.length === 0 && updates.length === 0) {
      await recordSyncRun({ provider: PROVIDER, status: "noop", recordsRead: rows.length, recordsWritten: 0 });
      return NextResponse.json({ ...summarize(plan, "commit"), imported: 0, updated: 0 });
    }

    let imported = 0;
    let firstId = "";
    let lastId = "";
    if (creates.length > 0) {
      const result = await bulkImportClients(
        creates.map((d) => ({
          name: d.name,
          phoneNumber: d.phoneNumber,
          status: d.status,
          project: d.project,
          location: d.location,
          acquisitionChannel: d.acquisitionChannel,
          operationToTake: d.operationToTake,
          firstContactPerson: d.firstContactPerson,
          secondContactPerson: d.secondContactPerson,
          createdAt: d.createdAt,
        })),
        session.name,
      );
      imported = result.imported;
      firstId = result.firstId;
      lastId = result.lastId;
    }

    // updateClient writes the same activity-log entries a manual edit does, so
    // the timeline explains where the change came from. Notifications are off:
    // reassigning a contact across a whole sheet would notify people who never
    // made the change.
    let updated = 0;
    for (const item of updates) {
      const res = await updateClient(item.clientId, item.patch, session.name, { notify: false });
      if (res.outcome === "updated") updated += 1;
    }

    // Reference values are registered only AFTER the rows landed, so a failure
    // here leaves unused labels in the picker rather than clients pointing at a
    // status that was never created. Scoped to the selected rows, so
    // deselecting every row that mentions a channel does not add that channel.
    await addSettingValues("statuses", newStatuses);
    await addSettingValues("channels", newChannels);
    await addSettingValues("locations", newLocations);

    await recordSyncRun({
      provider: PROVIDER,
      status: "ok",
      recordsRead: rows.length,
      // Created plus updated: this is the only counter the table carries.
      recordsWritten: imported + updated,
    });

    return NextResponse.json({
      ...summarize(plan, "commit"),
      imported,
      updated,
      firstId,
      lastId,
    });
  } catch (error) {
    if (error instanceof SheetError) {
      await recordSyncRun({ provider: PROVIDER, status: "error", recordsRead: 0, recordsWritten: 0, error: error.message });
      return errorResponse(error.message, 502);
    }
    await recordSyncRun({ provider: PROVIDER, status: "error", recordsRead: 0, recordsWritten: 0, error: databaseErrorMessage(error) });
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/** Lets the UI show which sheet is configured without fetching it. */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const session = await getSessionUser(request);
  if (!session || session.role !== "Admin") return errorResponse(ERR_ADMIN, 403);
  return NextResponse.json({ source: sheetUrl() });
}
