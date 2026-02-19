import path from "path";
import fs from "fs";

export type ExcelCell = { row: number; col: number; value: string };
export type ExcelMerge = { startRow: number; startCol: number; endRow: number; endCol: number };
export type ExcelSheet = {
  sheetName: string;
  cells: ExcelCell[];
  merges: ExcelMerge[];
};
export type ExcelStructuredData = {
  fileName: string;
  sheets: ExcelSheet[];
};

function cellToStr(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "string" || typeof c === "number") return String(c).trim();
  if (typeof c === "object") {
    const o = c as { text?: string; hyperlink?: string; richText?: unknown[] };
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.hyperlink === "string") return o.hyperlink.trim();
    if (Array.isArray(o.richText) && o.richText.length > 0) {
      return o.richText
        .map((t: unknown) => (typeof t === "object" && t != null && "text" in t ? String((t as { text: string }).text) : ""))
        .join("")
        .trim();
    }
  }
  return "";
}

/**
 * Extracts Excel (.xlsx) to a structured JSON with cell coordinates and merge ranges.
 * Only the first sheet is processed (same as extractTextFromFile). For .xls, falls back to empty structure.
 */
export async function extractExcelToStructuredJson(filePath: string): Promise<ExcelStructuredData> {
  if (!fs.existsSync(filePath)) {
    return { fileName: path.basename(filePath), sheets: [] };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".xlsx") {
    return { fileName: path.basename(filePath), sheets: [] };
  }
  const ExcelJS = await import("exceljs");
  const mod = (ExcelJS as { default?: { Workbook?: unknown }; Workbook?: unknown }).default ?? ExcelJS;
  const Workbook = mod.Workbook as new () => {
    xlsx: { readFile: (p: string) => Promise<void> };
    worksheets: {
      name: string;
      eachRow: (opts: { includeEmpty: boolean }, cb: (row: {
        number: number;
        values: unknown[];
        getCell: (col: number) => { value: unknown };
      }) => void) => void;
      _merges?: Record<string, { top: number; left: number; bottom: number; right: number }>;
    }[];
  };
  const workbook = new Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheets: ExcelSheet[] = [];
  const sheetsToUse = workbook.worksheets.slice(0, 1);
  for (const sheet of sheetsToUse) {
    const cells: ExcelCell[] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      if (!values || values.length < 1) return;
      const rowNum = row.number;
      for (let col = 1; col < values.length; col++) {
        const raw = values[col];
        const value = cellToStr(raw);
        if (value.length > 0) {
          cells.push({ row: rowNum, col, value });
        }
      }
    });
    const merges: ExcelMerge[] = [];
    const mergesObj = (sheet as unknown as { _merges?: Record<string, { top: number; left: number; bottom: number; right: number }> })._merges;
    if (mergesObj && typeof mergesObj === "object") {
      for (const dimensions of Object.values(mergesObj)) {
        if (dimensions && typeof dimensions.top === "number" && typeof dimensions.left === "number") {
          merges.push({
            startRow: dimensions.top,
            startCol: dimensions.left,
            endRow: typeof dimensions.bottom === "number" ? dimensions.bottom : dimensions.top,
            endCol: typeof dimensions.right === "number" ? dimensions.right : dimensions.left,
          });
        }
      }
    }
    sheets.push({ sheetName: sheet.name, cells, merges });
  }
  return { fileName: path.basename(filePath), sheets };
}
