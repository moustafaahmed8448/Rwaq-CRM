import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import {
  addSettingValues,
  bulkImportClients,
  databaseErrorMessage,
  existingClientKeys,
  readSetting,
  recordSyncRun,
} from "@/lib/db";
import { fetchSheetRows, sheetUrl, SheetError } from "@/lib/google-sheet";
import { buildImportPlan } from "@/lib/import-clients";

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

/** Reference values + existing client keys, all read in one round trip. */
async function loadContext() {
  const [statuses, channels, locations, existingKeys] = await Promise.all([
    readSetting("statuses"),
    readSetting("channels"),
    readSetting("locations"),
    existingClientKeys(),
  ]);
  return { refs: { statuses, channels, locations }, existingKeys };
}

/** The preview payload, shared by both modes so the UI renders one shape. */
function summarize(plan: ReturnType<typeof buildImportPlan>, mode: "preview" | "commit") {
  return {
    mode,
    source: sheetUrl(),
    toCreate: plan.drafts.length,
    skipped: plan.skipped.length,
    skippedByReason: plan.skipped.reduce<Record<string, number>>((acc, row) => {
      acc[row.reason] = (acc[row.reason] ?? 0) + 1;
      return acc;
    }, {}),
    // 56 rows have no تاريخ التسجيل; they are imported with today's date.
    dateAssumed: plan.drafts.filter((d) => d.dateAssumed).length,
    newStatuses: plan.newStatuses,
    newChannels: plan.newChannels,
    newLocations: plan.newLocations,
    statusMapping: plan.statusMapping,
    repairedRows: plan.repairedRows,
    // Capped so a 300-row skip list cannot bloat the response; the counts above
    // stay exact. The first entries are shown so the user can spot a pattern.
    skippedSample: plan.skipped.slice(0, 25),
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
    const { refs, existingKeys } = await loadContext();
    const plan = buildImportPlan(rows, refs, existingKeys);

    if (mode === "preview") {
      return NextResponse.json(summarize(plan, "preview"));
    }

    if (plan.drafts.length === 0) {
      await recordSyncRun({ provider: PROVIDER, status: "noop", recordsRead: rows.length, recordsWritten: 0 });
      return NextResponse.json({ ...summarize(plan, "commit"), imported: 0 });
    }

    const result = await bulkImportClients(
      plan.drafts.map((d) => ({
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

    // Reference values are registered only AFTER the rows landed, so a failure
    // here leaves unused labels in the picker rather than clients pointing at a
    // status that was never created.
    await addSettingValues("statuses", plan.newStatuses);
    await addSettingValues("channels", plan.newChannels);
    await addSettingValues("locations", plan.newLocations);

    await recordSyncRun({
      provider: PROVIDER,
      status: "ok",
      recordsRead: rows.length,
      recordsWritten: result.imported,
    });

    return NextResponse.json({
      ...summarize(plan, "commit"),
      imported: result.imported,
      firstId: result.firstId,
      lastId: result.lastId,
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
