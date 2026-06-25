import type { ExcelSheet } from "@/lib/excel-structured-extract";
import { normalizeForMatch } from "@/lib/hybrid-search";

const GANTT_SHEET = /gantt|cronograma|carta\s*gantt/i;
const MEETING_SHEET = /reuni[oó]n|reunion/i;

/** Prioridad 0–100: hojas de resumen primero, Gantt/reuniones al final. */
export function sheetPriorityScore(sheetName: string): number {
  const n = normalizeForMatch(sheetName);
  if (/resumen/.test(n) && /proyecto/.test(n)) return 100;
  if (/resumen/.test(n)) return 92;
  if (/ficha|informaci[oó]n\s*general/.test(n)) return 88;
  if (/proyecto/.test(n) && !GANTT_SHEET.test(n)) return 82;
  if (GANTT_SHEET.test(n)) return 8;
  if (/indicador|presupuesto|equipo/.test(n)) return 35;
  if (MEETING_SHEET.test(n)) return 20;
  return 55;
}

export function isGanttOrTrackingSheet(sheetName: string): boolean {
  return GANTT_SHEET.test(sheetName) || /^cier$/i.test(sheetName.trim());
}

export function sortSheetsByPriority<T extends { sheetName: string }>(sheets: T[]): T[] {
  return [...sheets].sort(
    (a, b) => sheetPriorityScore(b.sheetName) - sheetPriorityScore(a.sheetName)
  );
}

/** Encabezados típicos de carta Gantt / tablas de seguimiento (no son valores de campo). */
const GANTT_HEADER_TERMS = [
  "nombre actividad",
  "descripcion de actividad",
  "tareas a realizar",
  "evidencias",
  "avance gantt",
  "de avance",
];

export function isGanttColumnHeaderLabel(label: string): boolean {
  const n = normalizeForMatch(label);
  if (GANTT_HEADER_TERMS.some((t) => n === t || n.startsWith(t))) return true;
  if (n.includes("nombre") && n.includes("actividad") && !n.includes("proyecto")) return true;
  return false;
}

export function isLikelyGanttHeaderRowContent(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  let headerLineHits = 0;
  for (const line of lines) {
    const n = normalizeForMatch(line);
    if (GANTT_HEADER_TERMS.some((t) => n.includes(t))) headerLineHits += 1;
    if (n.includes("nombre actividad")) headerLineHits += 2;
  }
  if (headerLineHits >= 2) return true;
  if (lines.length >= 2 && lines.every((l) => l.length < 45 && l === l.toUpperCase())) return true;
  return false;
}

export function isTableHeaderRow(values: string[]): boolean {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (nonEmpty.length < 3) return false;
  const upperShort = nonEmpty.filter((v) => v.length < 45 && v === v.toUpperCase()).length;
  if (upperShort >= 3) return true;
  const ganttHits = nonEmpty.filter((v) => isGanttColumnHeaderLabel(v)).length;
  return ganttHits >= 2;
}

export function isProjectNameElement(element: { title: string; description?: string }): boolean {
  const t = normalizeForMatch(element.title);
  if (t.includes("objetivo")) return false;
  return (
    (t.includes("nombre") && t.includes("proyecto")) ||
    t === "nombre del proyecto" ||
    /^nombre\s+(del\s+)?proyecto$/i.test(element.title.trim())
  );
}

/** Extrae nombre desde celda tipo "Proyecto: Agua Conecta (Vinculamos ID …)". */
export function parseProjectNameFromCellText(text: string): string | null {
  const trimmed = text.trim();
  const m = trimmed.match(/Proyecto\s*:\s*(.+)/i);
  if (!m) return null;
  let name = m[1].trim();
  name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  name = name.replace(/\s*-\s*Vinculamos.*$/i, "").trim();
  if (name.length < 2 || name.length > 200) return null;
  if (isLikelyGanttHeaderRowContent(name)) return null;
  return name;
}

export function extractProjectNameFromSheet(sheet: ExcelSheet): string | null {
  for (const cell of sheet.cells) {
    const parsed = parseProjectNameFromCellText(cell.value);
    if (parsed) return parsed;
  }
  return null;
}
