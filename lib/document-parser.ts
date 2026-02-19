import path from "path";
import fs from "fs";

// Dynamic imports for CJS/ESM modules
async function loadPdfParse() {
  const pdfParse = await import("pdf-parse");
  return pdfParse.default;
}

export async function extractTextFromFile(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) return "";
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === ".pdf") {
      const pdfParse = await loadPdfParse();
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return (data?.text ?? "").trim();
    }
    if (ext === ".docx" || ext === ".doc") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      return (result?.value ?? "").trim();
    }
    if (ext === ".xlsx" || ext === ".xls") {
      const ExcelJS = await import("exceljs");
      const mod = (ExcelJS as { default?: { Workbook?: unknown }; Workbook?: unknown }).default ?? ExcelJS;
      const Workbook = (mod as { Workbook: new () => { xlsx: { readFile: (p: string) => Promise<void> }; worksheets: { name: string; eachRow: (cb: (row: { values: (string | number | undefined)[] }) => void) => void }[] } }).Workbook;
      const workbook = new Workbook();
      await workbook.xlsx.readFile(filePath);
      const parts: string[] = [];
      const sheetsToUse = workbook.worksheets.slice(0, 1);
      sheetsToUse.forEach((sheet) => {
        const rows: string[] = [];
        function cellToStr(c: unknown): string {
          if (c == null) return "";
          if (typeof c === "string" || typeof c === "number") return String(c).trim();
          if (typeof c === "object") {
            const o = c as { text?: string; hyperlink?: string };
            if (typeof o.text === "string") return o.text.trim();
            if (typeof o.hyperlink === "string") return o.hyperlink.trim();
          }
          return "";
        }
        sheet.eachRow((row: { values: unknown[] }) => {
          const cells = row.values as unknown[];
          if (!cells || cells.length < 2) return;
          const trimmed = cells.slice(1).map(cellToStr).filter((c) => c.length > 0);
          if (trimmed.length === 0) return;
          if (trimmed.length === 1) {
            rows.push(trimmed[0]);
          } else {
            const element = trimmed[0];
            const content = trimmed.slice(1).join("\n").trim();
            if (content) rows.push(`${element}: ${content}`);
            else rows.push(element);
          }
        });
        if (rows.length) parts.push(`[Hoja: ${sheet.name}]\n${rows.join("\n")}`);
      });
      const fullText = parts.join("\n\n").trim();
      return fullText;
    }
    if (ext === ".pptx" || ext === ".ppt") {
      return "[Presentación PPT/PPTX: extracción de texto no implementada. Use PDF o DOCX para el contenido.]";
    }
    // Plain text
    if ([".txt", ".md", ".json"].includes(ext)) {
      return fs.readFileSync(filePath, "utf-8").trim();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[Error extrayendo texto: ${msg}]`;
  }

  return "[Formato no soportado para extracción de texto]";
}

export function getSupportedExtensions(): string[] {
  return [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".txt", ".md", ".json"];
}
