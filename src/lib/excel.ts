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
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF4F46E5" },
};

export async function buildWorkbook(sheets: ExcelSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rwaq CRM";
  workbook.created = new Date();

  for (const spec of sheets) {
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

    for (const row of spec.rows) sheet.addRow(row);

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
