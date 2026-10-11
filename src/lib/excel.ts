import ExcelJS from "exceljs";

/**
 * Minimal .xlsx builder. ExcelJS keeps everything server-side so the browser
 * never has to download a spreadsheet library.
 */

export type ExcelCell = string | number | Date | null | undefined;

export type ExcelColumn = {
  header: string;
  key: string;
  width?: number;
  /** Excel number format, e.g. '"SAR" #,##0.00' or 'dd/mm/yyyy' */
  numFmt?: string;
};

export type ExcelSheet = {
  name: string;
  columns: ExcelColumn[];
  rows: Array<Record<string, ExcelCell>>;
  /** Optional emphasised final row (e.g. totals). */
  totalsRow?: Record<string, ExcelCell>;
  /**
   * Keys whose cells hold a real `Date` and should be written as dates.
   *
   * Without this a Date cell is serialized to a bare number, so Excel shows
   * `46654` instead of a date. The writer already accepts `Date` cells; this is
   * what tells it to apply a number format so the column reads as a date and
   * sorts chronologically. Columns not listed keep their default text handling.
   */
  dateColumns?: string[];
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF4F46E5" },
};

export async function buildWorkbook(
  sheets: ExcelSheet[],
  /**
   * "Author" written into the file's metadata. Export routes pass the
   * admin-set workspace name (Setting row `brand`), so a downloaded file from
   * any white-labeled tenant says that company's name rather than the original
   * brand. Falls back to the legacy constant when omitted or empty.
   */
  creator?: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = (creator ?? "").trim() || "Rwaq CRM";
  workbook.created = new Date();

  for (const spec of sheets) {
    // Columns holding a real Date need a display format, or Excel renders the
    // underlying serial number. Resolved once per sheet so the row loop below
    // stays a straight pass.
    const dateKeys = new Set(spec.dateColumns ?? []);

    const sheet = workbook.addWorksheet(spec.name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = spec.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? 18,
      ...(column.numFmt ? { style: { numFmt: column.numFmt } } : {}),
    }));

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    header.fill = HEADER_FILL;
    header.alignment = { vertical: "middle", horizontal: "left" };
    header.height = 22;

    for (const row of spec.rows) {
      const added = sheet.addRow(row);
      // Applied per cell after the row lands: exceljs resolves `style.numFmt`
      // on the column, but a Date written through `addRow` is coerced to text
      // unless the CELL carries a date number format.
      if (dateKeys.size > 0) {
        spec.columns.forEach((column, index) => {
          if (dateKeys.has(column.key)) added.getCell(index + 1).numFmt = DATE_FMT;
        });
      }
    }

    if (spec.totalsRow) {
      const totals = sheet.addRow(spec.totalsRow);
      totals.font = { bold: true };
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(spec.columns.length, 1) },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** YYYY-MM-DD for filenames. */
export const dateStamp = (): string => new Date().toISOString().slice(0, 10);

export const MONEY_FMT = '"SAR" #,##0.00';
export const INT_FMT = "#,##0";
export const DATE_FMT = "dd/mm/yyyy";
