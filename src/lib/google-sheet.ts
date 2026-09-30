/**
 * Google Sheets client-lead sheet reader.
 *
 * The sheet is public, so it is read through Google's "gviz" endpoint, which
 * returns JSON with per-cell typing. That matters for the two fields the CRM
 * cannot guess: a date cell arrives as `Date(2026,6,14)` (note the ZERO-INDEXED
 * month) with the display string in `f` as `"7/14/2026"`, so nothing has to be
 * re-parsed from an ambiguous locale-formatted text.
 *
 * Columns are matched BY HEADER LABEL rather than by position. The sheet is
 * maintained by hand, and one insertion in the middle would otherwise silently
 * shift every later column and write a project description into the phone
 * column. Index is only a fallback for a renamed header.
 */

/** Defaults match the live workbook; override per environment via env vars. */
const DEFAULT_SHEET_ID = "1_sVksl-_b8KerzZ2hyKaShMYDJQkKh6Z";
const DEFAULT_SHEET_GID = "1879689378";

export const sheetId = (): string => (process.env.GOOGLE_SHEET_ID || "").trim() || DEFAULT_SHEET_ID;
export const sheetGid = (): string => (process.env.GOOGLE_SHEET_GID || "").trim() || DEFAULT_SHEET_GID;

/** The public share URL, offered to the user so they can confirm the source. */
export const sheetUrl = (): string =>
  `https://docs.google.com/spreadsheets/d/${sheetId()}/edit#gid=${sheetGid()}`;

/**
 * Header label -> Client field. Every label is normalized with `cleanText`
 * first, which drops the stray leading space the sheet has on the 1st-contact
 * column (" مسئول التواصل…") and any bidi marks a paste may have introduced.
 */
const COLUMN_BY_HEADER: Record<string, keyof SheetRow> = {
  "رقم الهاتف": "phone",
  "الاسم": "name",
  "حالة العميل": "status",
  "المشروع": "project",
  "الموقع": "location",
  "تاريخ التسجيل": "registeredAt",
  "الإجراء": "operation",
  "مسئول التواصل على اخر تحديث للعميل": "firstContact",
  "المندوب المسئول عن العميل": "secondContact",
  "جهة العميل": "channel",
};

/** Positional fallback, in the sheet's current column order. */
const COLUMN_BY_INDEX: Array<keyof SheetRow | null> = [
  null, // م — the sheet's own row number; deliberately ignored (see plan).
  "phone",
  "name",
  "status",
  "project",
  "location",
  "registeredAt",
  "operation",
  "firstContact",
  "secondContact",
  null, // تاريخ اخر تحديث على العميل — ignored, see plan.
  "channel",
];

export interface SheetRow {
  /** 1-based row number in the sheet, used to point the user at a source row. */
  rowNumber: number;
  phone: string;
  name: string;
  status: string;
  project: string;
  location: string;
  registeredAt: Date | null;
  operation: string;
  firstContact: string;
  secondContact: string;
  channel: string;
  /** Fields whose source cell arrived carrying damaged characters. */
  repaired: string[];
}

export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetError";
  }
}

/**
 * Cleans a raw cell string.
 *
 * U+FFFD is what a truncated/copy-pasted Arabic string decodes to, and the
 * source sheet really does contain it: `الشر��ة` instead of `الشركة`. Left in
 * place it would fork one reference value into two, because "الشرة" and
 * "الشركة" are different strings — so the damaged characters are removed and
 * the row is reported in `repaired` rather than silently mangled. U+200F (RTL
 * mark) is stripped outright: it is invisible and only breaks equality checks.
 */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[�‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the raw cell contained a character we had to strip. */
const hadDamagedChar = (value: unknown): boolean =>
  typeof value === "string" && /[�‎‏]/.test(value);

/** Local midnight, so the value lines up with the report boundaries in db.ts. */
function localMidnight(date: Date): Date | null {
  if (Number.isNaN(date.getTime())) return null;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Parses a date cell.
 *
 * Prefers the typed `Date(y,m,d)` form, where the month is zero-indexed, and
 * falls back to the sheet's own `M/D/YYYY` display string. Both become LOCAL
 * midnight, matching `startOfLocalDay` in src/lib/db.ts — a UTC-midnight value
 * would drop a day in any timezone east of Greenwich.
 */
export function parseSheetDate(value: unknown, formatted?: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    // Bare gviz serial for a date column (days since the epoch).
    return localMidnight(new Date(value * 86400000));
  }

  if (typeof value === "string") {
    const typed = /^Date\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)$/.exec(value.trim());
    if (typed) {
      return localMidnight(new Date(Number(typed[1]), Number(typed[2]), Number(typed[3])));
    }
  }

  // Fall back to the display string, which is M/D/YYYY on this sheet.
  const text = cleanText(formatted ?? value);
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (mdy) {
    return localMidnight(new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2])));
  }
  return null;
}

/* ── gviz wire format ──────────────────────────────────────────────────────── */

type GvizCell = { v?: unknown; f?: unknown } | null;
type GvizResponse = {
  status?: string;
  table?: {
    cols?: Array<{ label?: string }>;
    rows?: Array<{ c?: GvizCell[] }>;
  };
};

/**
 * Downloads and parses the sheet.
 *
 * gviz replies with `/*O_o*\/ google.visualization.Query.setResponse({...});`
 * rather than bare JSON, so the object is sliced out before parsing. A private
 * or deleted sheet answers 200 with an HTML error page, which is why the body is
 * also checked for the expected prefix before parsing.
 */
export async function fetchSheetRows(signal?: AbortSignal): Promise<SheetRow[]> {
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId())}` +
    `/gviz/tq?tqx=out:json&gid=${encodeURIComponent(sheetGid())}`;

  let res: Response;
  try {
    res = await fetch(url, { signal, cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    throw new SheetError("Could not reach Google Sheets");
  }

  if (!res.ok) {
    throw new SheetError(
      res.status === 400 || res.status === 404
        ? "The sheet is not publicly readable"
        : `Google Sheets returned ${res.status}`,
    );
  }

  const body = await res.text();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SheetError("The sheet is not publicly readable");

  let payload: GvizResponse;
  try {
    payload = JSON.parse(body.slice(start, end + 1)) as GvizResponse;
  } catch {
    throw new SheetError("Could not read the sheet response");
  }
  if (payload.status && payload.status !== "ok") {
    throw new SheetError(`Google Sheets reported: ${payload.status}`);
  }

  const table = payload.table;
  if (!table?.cols?.length) throw new SheetError("The sheet returned no columns");

  // Resolve each field to a column index, preferring the header label.
  const indexByField = new Map<keyof SheetRow, number>();
  table.cols.forEach((col, index) => {
    const field = COLUMN_BY_HEADER[cleanText(col.label)];
    if (field && !indexByField.has(field)) indexByField.set(field, index);
  });
  const indexOf = (field: keyof SheetRow): number =>
    indexByField.get(field) ?? COLUMN_BY_INDEX.indexOf(field);

  const cell = (cells: GvizCell[], field: keyof SheetRow): GvizCell => {
    const index = indexOf(field);
    return index >= 0 ? (cells[index] ?? null) : null;
  };

  const rows = table.rows ?? [];
  return rows.map((row, position) => {
    const cells = row.c ?? [];
    const text = (field: keyof SheetRow): string => cleanText(cell(cells, field)?.v);

    // Flag any field whose source cell was damaged, before cleaning hides it.
    const repaired = (Object.keys(COLUMN_BY_HEADER) as Array<keyof SheetRow>).filter((field) => {
      const c = cell(cells, field);
      return hadDamagedChar(c?.v) || hadDamagedChar(c?.f);
    });

    const dateCell = cell(cells, "registeredAt");
    return {
      rowNumber: position + 2, // 1-based, and row 1 is the header.
      phone: text("phone"),
      name: text("name"),
      status: text("status"),
      project: text("project"),
      location: text("location"),
      registeredAt: parseSheetDate(dateCell?.v, dateCell?.f),
      operation: text("operation"),
      firstContact: text("firstContact"),
      secondContact: text("secondContact"),
      channel: text("channel"),
      repaired,
    };
  });
}

