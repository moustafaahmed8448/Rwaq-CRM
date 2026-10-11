import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import {
  addSettingValues,
  bulkImportClients,
  databaseErrorMessage,
  lastSyncRun,
  latestClientUpdate,
  listImportBaseline,
  readSetting,
  recordSyncRun,
  updateClient,
} from "@/lib/db";
import { applySelection, buildImportPlan, type RowSelection } from "@/lib/import-clients";
import { UploadError, readUploadedRows } from "@/lib/excel-read";

/**
 * Imports clients from an UPLOADED spreadsheet (.xlsx / .xls / .csv).
 *
 * The same two modes as /api/import/clients, over the same planner:
 *   preview — read-only; reports exactly what a commit would do
 *   commit  — performs the write
 *
 * The point of putting it in its own route rather than adding a branch to the
 * sheet one is that the SOURCE is the only difference: `readUploadedRows`
 * returns the same `SheetRow[]` `fetchSheetRows` does, so `buildImportPlan`,
 * `applySelection`, the skip reasons, the status mapping, the reference-value
 * registration and the SyncRun row are literally the same code. There is no
 * second importer to drift out of step with the first.
 *
 * Admin-only for the same reason the sheet import is: a commit writes hundreds
 * of clients AND appends to the shared status/channel/location reference lists,
 * so it is workspace-wide reference data, not one rep's data.
 *
 * The rows arrive as multipart/form-data (a file, not JSON), so this is a
 * separate handler rather than another method on the JSON route.
 */

/** Distinguishes these runs from Google Sheet runs in the SyncRun log. */
const PROVIDER = "excel-upload";

/** Error strings surfaced to the browser; registered in api-errors.ts. */
const ERR_ADMIN = "Only admins can import clients";
const ERR_NO_FILE = "No file was uploaded";

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

/** The preview payload — identical shape to the sheet route's, so one UI renders both. */
function summarize(plan: ReturnType<typeof buildImportPlan>, mode: "preview" | "commit", source: string) {
  const count = (kind: string): number => plan.diff.filter((r) => r.kind === kind).length;
  return {
    mode,
    source,
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

/**
 * Reads the row selection from the multipart form.
 *
 * It travels as a JSON string field rather than as structured form data because
 * `FormData` has no array-of-objects type, and a second file field would mean
 * uploading the spreadsheet twice.
 */
function parseSelection(value: FormDataEntryValue | null): RowSelection[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RowSelection =>
        typeof r === "object" && r !== null &&
        typeof (r as RowSelection).rowNumber === "number",
    );
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  const session = await getSessionUser(request);
  if (!session || session.role !== "Admin") return errorResponse(ERR_ADMIN, 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected a file upload");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse(ERR_NO_FILE);

  const mode = form.get("mode") === "commit" ? "commit" : "preview";
  // The filename IS the source string, so the preview names the file the user
  // picked instead of a sheet URL that has nothing to do with it.
  const source = file.name;

  let rows;
  try {
    rows = await readUploadedRows(file.name, Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    const message = error instanceof UploadError ? error.message : "Could not read the file.";
    // Logged like a sheet failure, so the health strip shows a failed upload too.
    await recordSyncRun({ provider: PROVIDER, status: "error", recordsRead: 0, recordsWritten: 0, error: message });
    return errorResponse(message, 502);
  }

  try {
    const { refs, baseline } = await loadContext();
    const plan = buildImportPlan(rows, refs, baseline);

    if (mode === "preview") return NextResponse.json(summarize(plan, "preview", source));

    const selection = parseSelection(form.get("rows"));
    const { creates, updates, newStatuses, newChannels, newLocations } =
      applySelection(plan, selection, refs);

    if (creates.length === 0 && updates.length === 0) {
      await recordSyncRun({ provider: PROVIDER, status: "noop", recordsRead: rows.length, recordsWritten: 0 });
      return NextResponse.json({ ...summarize(plan, "commit", source), imported: 0, updated: 0 });
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
    // reassigning a contact across a whole file would notify people who never
    // made the change.
    let updated = 0;
    for (const item of updates) {
      const res = await updateClient(item.clientId, item.patch, session.name, { notify: false });
      if (res.outcome === "updated") updated += 1;
    }

    // Registered only AFTER the rows land, so a failure here leaves unused
    // labels in the picker rather than clients pointing at a status that was
    // never created. Scoped to the selected rows.
    await addSettingValues("statuses", newStatuses);
    await addSettingValues("channels", newChannels);
    await addSettingValues("locations", newLocations);

    await recordSyncRun({
      provider: PROVIDER,
      status: "ok",
      recordsRead: rows.length,
      recordsWritten: imported + updated,
    });

    return NextResponse.json({ ...summarize(plan, "commit", source), imported, updated, firstId, lastId });
  } catch (error) {
    await recordSyncRun({
      provider: PROVIDER,
      status: "error",
      recordsRead: rows.length,
      recordsWritten: 0,
      error: databaseErrorMessage(error),
    });
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Upload import health, read-only. Mirrors the sheet route's GET so the status
 * strip can show whichever source was used most recently.
 *
 * Admin-only for the same reason the commit is: it reports the state of
 * workspace-wide reference data.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const session = await getSessionUser(request);
  if (!session || session.role !== "Admin") return errorResponse(ERR_ADMIN, 403);

  const [last, latest] = await Promise.all([lastSyncRun(PROVIDER), latestClientUpdate()]);
  const finishedAt = last?.finishedAt ?? null;
  return NextResponse.json({
    provider: PROVIDER,
    lastSyncRun: last,
    latestClientUpdate: latest,
    // Both sides are `iso()`-formatted UTC, so the string comparison IS the
    // chronological one — same rule the sheet route uses.
    rowsNewerThanLastImport: Boolean(finishedAt && latest && latest > finishedAt),
  });
}
