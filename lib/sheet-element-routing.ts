import type { ExcelSheet } from "@/lib/excel-structured-extract";
import type { ElementDef } from "@/lib/excel-heuristics";
import type { ExtractConfig } from "@/lib/evaluation-type-settings";
import { defaultExtractConfig } from "@/lib/evaluation-type-settings";
import { normalizeForMatch } from "@/lib/text-match";
import { sortSheetsByPriority } from "@/lib/excel-sheet-priority";

export const GANTT_SHEET_RE = /gantt|cronograma|carta\s*gantt|plan\s+de\s+actividad/i;
const INDICATORS_SHEET_RE = /indicador/i;
const RESUMEN_SHEET_RE = /resumen|ficha|informaci[oó]n\s*general/i;

export type SheetPatternsConfig = ExtractConfig["sheetPatterns"];

function patternToRe(pattern: string, fallback: RegExp): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return fallback;
  }
}

export function resolveSheetPatterns(
  patterns?: Partial<SheetPatternsConfig> | null
): { gantt: RegExp; indicators: RegExp; resumen: RegExp } {
  const defaults = defaultExtractConfig().sheetPatterns;
  return {
    gantt: patternToRe(patterns?.gantt ?? defaults.gantt, GANTT_SHEET_RE),
    indicators: patternToRe(patterns?.indicators ?? defaults.indicators, INDICATORS_SHEET_RE),
    resumen: patternToRe(patterns?.resumen ?? defaults.resumen, RESUMEN_SHEET_RE),
  };
}

export function isGanttSheetName(
  sheetName: string,
  sheetPatterns?: Partial<SheetPatternsConfig> | null
): boolean {
  return resolveSheetPatterns(sheetPatterns).gantt.test(normalizeForMatch(sheetName));
}

function elementContextText(element: { title: string; description?: string; section?: string }): string {
  return normalizeForMatch(`${element.title} ${element.section ?? ""} ${element.description ?? ""}`);
}

export function isGanttActivitiesElement(element: {
  title: string;
  description?: string;
  section?: string;
}): boolean {
  const t = elementContextText(element);
  return (
    (/actividad/.test(t) && /gantt|cronograma|plan\s+de\s+actividad/.test(t)) ||
    t.includes("actividades del proyecto")
  );
}

export function isIndicatorsTableElement(element: { title: string; description?: string }): boolean {
  const t = normalizeForMatch(`${element.title} ${element.description ?? ""}`);
  if (/metodolog/.test(t) && /medici/.test(t)) return false;
  return /^indicador/.test(t) || (t.includes("indicador") && !t.includes("metodolog"));
}

export function isResumenFormElement(element: { title: string; description?: string }): boolean {
  const t = normalizeForMatch(`${element.title} ${element.description ?? ""}`);
  if (isGanttActivitiesElement(element) || isIndicatorsTableElement(element)) return false;
  return (
    /sostenibilidad|escalabilidad|factor innovador|ejes?\s+de\s+impacto|focalizaci|resultados|contribuci|desarrollo sostenible|ods\b/.test(
      t
    ) || /necesidad|problema|pertinencia|publico|genero|consiste la soluci/.test(t)
  );
}

function sheetsMatchingPriority(
  sheets: ExcelSheet[],
  priorityPatterns: string[]
): ExcelSheet[] | null {
  if (priorityPatterns.length === 0) return null;
  const matched: ExcelSheet[] = [];
  for (const pattern of priorityPatterns) {
    const re = patternToRe(pattern, /$^/);
    for (const sheet of sheets) {
      if (re.test(normalizeForMatch(sheet.sheetName)) && !matched.includes(sheet)) {
        matched.push(sheet);
      }
    }
  }
  return matched.length > 0 ? matched : null;
}

/** Ordena hojas según el elemento: Gantt/Indicadores primero cuando corresponde. */
export function sheetsForElement(
  element: ElementDef,
  sheets: ExcelSheet[],
  sheetPatterns?: Partial<SheetPatternsConfig> | null
): ExcelSheet[] {
  const patterns = resolveSheetPatterns(sheetPatterns);
  const n = (s: ExcelSheet) => normalizeForMatch(s.sheetName);

  const elementPriority = element.extractStrategy?.sheetPriority;
  if (elementPriority?.length) {
    const prioritized = sheetsMatchingPriority(sheets, elementPriority);
    if (prioritized) return prioritized;
  }

  if (isGanttActivitiesElement(element)) {
    const gantt = sheets.filter((s) => patterns.gantt.test(n(s)));
    if (gantt.length > 0) return gantt;
  }

  if (isIndicatorsTableElement(element)) {
    const ind = sheets.filter((s) => patterns.indicators.test(n(s)));
    if (ind.length > 0) return ind;
  }

  if (isResumenFormElement(element)) {
    const resumen = sheets.filter((s) => patterns.resumen.test(n(s)));
    const rest = sheets.filter((s) => !patterns.resumen.test(n(s)));
    if (resumen.length > 0) return [...resumen, ...sortSheetsByPriority(rest)];
  }

  return sortSheetsByPriority(sheets);
}
