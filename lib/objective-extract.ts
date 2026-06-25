import type { ExcelSheet, ExcelStructuredData, ExcelCell } from "@/lib/excel-structured-extract";
import { normalizeForMatch } from "@/lib/hybrid-search";
import { joinUniqueParts } from "@/lib/extract-content-clean";
import { sortSheetsByPriority } from "@/lib/excel-sheet-priority";

type ElementLike = { title: string; description?: string };

const SPECIFIC_OBJ_RE = /objetivos\s+espec[ií]ficos/i;
const GENERAL_OBJ_RE = /objetivo\s+general/i;
const SECTION_STOP_RE = /desarrollo\s+t[eé]cnico|continuidad\s+de\s+fases|formulario\s+de\s+postulaci/i;

export function isSpecificObjectivesElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return t.includes("objetivo") && t.includes("especif");
}

export function isObjectiveGeneralElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return t.includes("objetivo") && t.includes("general") && !t.includes("especif");
}

export function isObjectiveSectionText(text: string): boolean {
  const n = normalizeForMatch(text);
  if (GENERAL_OBJ_RE.test(n) && n.length < 80) return true;
  if (SPECIFIC_OBJ_RE.test(n) && n.length < 80) return true;
  return false;
}

function buildCellMap(cells: ExcelCell[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of cells) {
    map.set(`${c.row},${c.col}`, c.value.trim());
  }
  return map;
}

function getCell(map: Map<string, string>, row: number, col: number): string {
  return map.get(`${row},${col}`) ?? "";
}

function splitSectionFromText(fullText: string, sectionRe: RegExp): string {
  const m = fullText.match(sectionRe);
  if (!m || m.index == null) return "";
  let after = fullText.slice(m.index + m[0].length).replace(/^:?\s*/, "");
  const stop = after.search(SECTION_STOP_RE);
  if (stop > 0) after = after.slice(0, stop);
  const nextSection = after.search(/\n\s*OBJETIVOS?\s+/i);
  if (nextSection > 0) after = after.slice(0, nextSection);
  return after.trim();
}

function collectRowSpan(map: Map<string, string>, row: number, startCol: number, endCol: number): string {
  const parts: string[] = [];
  for (let c = startCol; c <= endCol; c++) {
    const v = getCell(map, row, c);
    if (v) parts.push(v);
  }
  return joinUniqueParts(parts);
}

function extractFromSheetBlock(sheet: ExcelSheet, sectionRe: RegExp): string {
  for (const cell of sheet.cells) {
    if (!sectionRe.test(cell.value)) continue;

    if (cell.value.length > 40) {
      const split = splitSectionFromText(cell.value, sectionRe);
      if (split.length > 15) return split;
    }

    const map = buildCellMap(sheet.cells);
    const below: string[] = [];
    const sameRow = collectRowSpan(map, cell.row, cell.col + 1, cell.col + 4);
    if (sameRow) below.push(sameRow);
    for (let r = cell.row + 1; r <= cell.row + 22; r++) {
      let rowText = "";
      for (let c = cell.col; c <= cell.col + 4; c++) {
        const v = getCell(map, r, c);
        if (v) rowText += (rowText ? " " : "") + v;
      }
      if (!rowText.trim()) {
        if (below.length > 0) break;
        continue;
      }
      if (SECTION_STOP_RE.test(rowText)) break;
      if (below.length > 0 && GENERAL_OBJ_RE.test(rowText) && !sectionRe.test(rowText)) break;
      below.push(rowText.trim());
    }
    const joined = joinUniqueParts(below);
    if (joined.length > 15) return joined;
  }
  return "";
}

function scoreObjectiveContent(content: string): number {
  const numbered = (content.match(/^\s*\d+[\.\)]\s/gm) ?? []).length;
  return content.length + numbered * 40;
}

export function extractSpecificObjectivesFromExcel(
  structuredFiles: ExcelStructuredData[]
): { content: string; confidence: number } | null {
  let best: { content: string; confidence: number } | null = null;
  for (const file of structuredFiles) {
    for (const sheet of sortSheetsByPriority(file.sheets)) {
      const content = extractFromSheetBlock(sheet, SPECIFIC_OBJ_RE);
      if (content.length <= 15) continue;
      const score = scoreObjectiveContent(content);
      if (!best || score > scoreObjectiveContent(best.content)) {
        best = { content, confidence: 0.93 };
      }
    }
  }
  return best;
}

export function extractObjectiveGeneralFromExcel(
  structuredFiles: ExcelStructuredData[]
): { content: string; confidence: number } | null {
  for (const file of structuredFiles) {
    for (const sheet of sortSheetsByPriority(file.sheets)) {
      let content = extractFromSheetBlock(sheet, GENERAL_OBJ_RE);
      if (content.length > 15) {
        const cut = content.split(SPECIFIC_OBJ_RE);
        content = cut[0].trim();
        if (content.length > 15) return { content, confidence: 0.93 };
      }
    }
  }
  return null;
}
