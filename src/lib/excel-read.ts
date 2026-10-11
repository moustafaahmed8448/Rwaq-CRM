/**
 * Uploaded-workbook reader: .xlsx / .xls / .csv -> SheetRow[].
 *
 * The app has only ever imported from ONE public Google Sheet. That is the real
 * constraint this removes: a company whose leads live in an Excel file, or a rep
 * who exported a list from anywhere else, had no way in.
 *
 * Deliberately produces the EXACT `SheetRow[]` the sheet importer returns, so
 * everything downstream is shared and cannot drift: `buildImportPlan`,
 * `applySelection`, the preview/commit contract, the skip reasons, the status
 * mapping, the reference-value registration and the SyncRun row all behave
 * identically no matter which source the rows came from. There is no second
 * planner and no second set of rules to keep in step.
 *
 * Parsing uses `exceljs`, which the export path already depends on — no new
 * runtime dependency. CSV is handled here rather than by exceljs because
 * exceljs has no CSV reader, and a quote-aware splitter is ~20 lines versus
 * adding a dependency for one format.
 */

import ExcelJS from "exceljs";
import { COLUMN_BY_HEADER, COLUMN_BY_INDEX, cleanText, parseSheetDate, type SheetRow } from "./google-sheet";

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Accepted extensions, so the UI and the server agree on what can be sent. */
export const UPLOAD_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

/** Largest upload accepted (bytes). Same order as the avatar/logo caps. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Largest row count parsed. Guards against a huge file stalling the request. */
const MAX_ROWS = 5000;

/** True when the raw cell contained a character `cleanText` had to strip. */
const hadDamagedChar = (value: unknown): boolean =>
  typeof value === "string" && /[�‎‏]/.test(value);

/**
 * A parsed grid: header labels plus body rows of raw cell values.
 *
 * Kept separate from `SheetRow` on purpose — the field mapping (header vs
 * positional fallback) is applied once, in `toSheetRows`, exactly as the gviz
 * reader does it.
 */
type Grid = { headers: string[]; body: unknown[][] };

/* ── CSV ──────────────────────────────────────────────────────────────────── */

/**
 * Quote-aware CSV split into rows of fields.
 *
 * Handles the two things a naive `split(",")` gets wrong for this data: a
 * quoted field containing a comma, and a quoted field containing a newline.
 * `""` inside a quoted field is an escaped quote. A BOM is stripped by the
 * caller, or it would corrupt the first header label.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    // CRLF, LF and a bare CR all end a record — files arrive from all three.
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  // Trailing field/row: a file ending without a newline still has data in it.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  // A final empty record is the file's trailing newline, not a blank lead.
  const last = rows.length - 1;
  if (last >= 0 && rows[last].length === 1 && rows[last][0] === "") rows.pop();
  return rows;
}

/* ── Workbook (.xlsx / .xls) ──────────────────────────────────────────────── */

/**
 * Reads the first worksheet into a grid.
 *
 * Only the FIRST sheet is read, matching the Google importer's single-sheet
 * scope. Asking which sheet to use would be a second decision surface for no
 * gain here: the sheet this replaces is one tab, and a workbook whose leads are
 * split across tabs is not a shape this importer should guess at.
 *
 * Cells are read with raw access so a date cell keeps its native `Date` for
 * `parseSheetDate` instead of arriving as a locale-formatted string.
 */
async function parseWorkbook(buffer: Buffer<ArrayBufferLike>): Promise<Grid> {
  const workbook = new ExcelJS.Workbook();
  /* exceljs ships its own narrower `Buffer` alias (one that carries the
     ArrayBuffer resizable members), which no plain Node Buffer satisfies
     structurally. The bytes are identical — this is a typing artefact of the
     dependency, not a conversion — so the cast is scoped to this one call. */
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new UploadError("The file has no data rows");

  const raw: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    raw.push([...(row.values as unknown[])]);
  });

  // exceljs `values` is 1-indexed, so element 0 is always an empty slot.
  const dropFirst = (cells: unknown[]): unknown[] => cells.slice(1);

  return {
    headers: dropFirst(raw[0]).map((cell) => cleanText(cell)),
    body: raw.slice(1, MAX_ROWS + 1).map(dropFirst),
  };
}

/* ── Grid -> SheetRow ─────────────────────────────────────────────────────── */

/**
 * Applies the shared header/positional mapping to a parsed grid.
 *
 * This is the same two-step resolution the gviz reader performs: match each
 * field to a column BY HEADER LABEL, falling back to position for a renamed or
 * missing header. Sharing the maps is what makes an uploaded file and the sheet
 * agree about which column is the phone number.
 */
function toSheetRows(grid: Grid): SheetRow[] {
  const indexByField = new Map<keyof SheetRow, number>();
  grid.headers.forEach((label, index) => {
    const field = COLUMN_BY_HEADER[label];
    if (field && !indexByField.has(field)) indexByField.set(field, index);
  });
  const indexOf = (field: keyof SheetRow): number =>
    indexByField.get(field) ?? COLUMN_BY_INDEX.indexOf(field);

  const cell = (cells: unknown[], field: keyof SheetRow): unknown => {
    const index = indexOf(field);
    return index >= 0 ? cells[index] : undefined;
  };

  return grid.body.map((cells, position) => {
    const text = (field: keyof SheetRow): string => cleanText(cell(cells, field));

    // Flag damaged cells before cleaning hides them, so the preview reports
    // them exactly as it does for the sheet.
    const repaired = (Object.keys(COLUMN_BY_HEADER) as Array<keyof SheetRow>).filter(
      (field) => hadDamagedChar(cell(cells, field)),
    );

    const dateCell = cell(cells, "registeredAt");
    return {
      // 1-based, and row 1 is the header — the same convention as the sheet, so
      // the preview's "row N" pointer means the same thing in both sources.
      rowNumber: position + 2,
      phone: text("phone"),
      name: text("name"),
      status: text("status"),
      project: text("project"),
      location: text("location"),
      // A CSV cell arrives as text, so the display-string branch of
      // parseSheetDate handles it; a workbook cell arrives as a real Date.
      registeredAt: parseSheetDate(dateCell),
      operation: text("operation"),
      firstContact: text("firstContact"),
      secondContact: text("secondContact"),
      channel: text("channel"),
      repaired,
    };
  });
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

/**
 * Parses an uploaded file into `SheetRow[]`.
 *
 * Rejects by EXTENSION and by size rather than by MIME type: browsers send
 * `application/vnd.openxmlformats-…` for .xlsx but a bare `text/csv` (or
 * nothing) for .csv depending on the OS, so the extension is the only signal
 * that is consistent across platforms.
 */
export async function readUploadedRows(
  filename: string,
  buffer: Buffer<ArrayBufferLike>,
): Promise<SheetRow[]> {
  const lower = filename.toLowerCase();
  if (!UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new UploadError("Unsupported file type. Upload an .xlsx, .xls or .csv file.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadError("The file is too large (max 8MB).");
  if (buffer.length === 0) throw new UploadError("The file is empty.");

  let grid: Grid;
  if (lower.endsWith(".csv")) {
    const rows = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new UploadError("The file has no data rows");
    grid = { headers: rows[0].map(cleanText), body: rows.slice(1, MAX_ROWS + 1) };
  } else {
    try {
      grid = await parseWorkbook(buffer);
    } catch (error) {
      // A wrong extension (a ".xlsx" that is really a CSV or an HTML error page)
      // surfaces as a zip/parse failure; say so plainly instead of leaking it.
      if (error instanceof UploadError) throw error;
      throw new UploadError("Could not read the file. It may be corrupt or not a spreadsheet.");
    }
  }

  return toSheetRows(grid);
}
