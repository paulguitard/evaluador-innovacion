import type { ExcelStructuredData, ExcelSheet, ExcelCell, ExcelMerge } from "@/lib/excel-structured-extract";
import { fuzzyMatchScore, normalizeForMatch } from "@/lib/hybrid-search";
import {
  isGanttColumnHeaderLabel,
  isLikelyGanttHeaderRowContent,
  isProjectNameElement,
  isTableHeaderRow,
  sheetPriorityScore,
  sortSheetsByPriority,
} from "@/lib/excel-sheet-priority";
import { detectProjectNameFromExcel } from "@/lib/project-name-detect";
import { joinUniqueParts, finalizeContentForElement } from "@/lib/extract-content-clean";
import {
  extractSpecificObjectivesFromExcel,
  extractObjectiveGeneralFromExcel,
  isSpecificObjectivesElement,
  isObjectiveGeneralElement,
  isObjectiveSectionText,
} from "@/lib/objective-extract";
import {
  extractFormRowFromExcel,
  looksLikeFormLabel,
  isFormRowElement,
} from "@/lib/form-row-extract";

export type ElementDef = { title: string; description: string; section?: string };

export type HeuristicMatch = {
  content: string;
  confidence: number;
  method: "label_value_row" | "label_value_col" | "merge_block" | "project_title_cell" | "none";
};

const HIGH_CONFIDENCE = 0.72;
const MIN_USABLE = 0.55;

export function isHighConfidenceHeuristic(confidence: number): boolean {
  return confidence >= HIGH_CONFIDENCE;
}

export function needsLlmFallback(confidence: number, content: string): boolean {
  if (isLikelyGanttHeaderRowContent(content)) return true;
  return !content.trim() || confidence < MIN_USABLE;
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

function collectMergeContent(
  map: Map<string, string>,
  merge: ExcelMerge,
  excludeRow?: number,
  excludeCol?: number
): string {
  const parts: string[] = [];
  for (let r = merge.startRow; r <= merge.endRow; r++) {
    for (let c = merge.startCol; c <= merge.endCol; c++) {
      if (r === excludeRow && c === excludeCol) continue;
      const v = getCell(map, r, c);
      if (v) parts.push(v);
    }
  }
  return joinUniqueParts(parts);
}

function collectImmediateRowValue(map: Map<string, string>, row: number, labelCol: number): string {
  const v = getCell(map, row, labelCol + 1);
  if (!v || isObjectiveSectionText(v)) return "";
  if (v.length > 200) return "";
  return v.trim();
}

function scoreLabelAgainstElement(label: string, element: ElementDef): number {
  if (isGanttColumnHeaderLabel(label)) return 0;

  const normEl = normalizeForMatch(element.title);
  const normLabel = normalizeForMatch(label);

  if (normEl.includes("proyecto") && normLabel.includes("actividad") && !normLabel.includes("proyecto")) {
    return 0;
  }
  if (
    normEl.includes("nombre") &&
    normEl.includes("proyecto") &&
    normLabel.includes("nombre") &&
    normLabel.includes("actividad")
  ) {
    return 0;
  }

  const titleScore = fuzzyMatchScore(label, element.title);
  const descScore = element.description ? fuzzyMatchScore(label, element.description) * 0.6 : 0;

  if (isProjectNameElement(element)) {
    if (!normLabel.includes("proyecto") && titleScore < 0.9) {
      return Math.min(titleScore, 0.35);
    }
  }

  return Math.max(titleScore, descScore);
}

function applyContentQuality(match: HeuristicMatch, element?: ElementDef): HeuristicMatch {
  if (!match.content.trim()) return match;
  if (isLikelyGanttHeaderRowContent(match.content)) {
    return { ...match, content: "", confidence: 0, method: "none" };
  }
  if (element) {
    const cleaned = finalizeContentForElement(match.content, element);
    return { ...match, content: cleaned };
  }
  return match;
}

function boostMatch(match: HeuristicMatch, sheetName: string): HeuristicMatch {
  const priority = sheetPriorityScore(sheetName) / 100;
  return { ...match, confidence: match.confidence * (0.4 + 0.6 * priority) };
}

function extractFromSheet(sheet: ExcelSheet, element: ElementDef): HeuristicMatch {
  const map = buildCellMap(sheet.cells);
  if (map.size === 0) return { content: "", confidence: 0, method: "none" };

  if (isProjectNameElement(element)) {
    return { content: "", confidence: 0, method: "none" };
  }

  if (isFormRowElement(element)) {
    return { content: "", confidence: 0, method: "none" };
  }

  let best: HeuristicMatch = { content: "", confidence: 0, method: "none" };

  const rows = [...new Set(sheet.cells.map((c) => c.row))].sort((a, b) => a - b);
  const cols = [...new Set(sheet.cells.map((c) => c.col))].sort((a, b) => a - b);

  for (const row of rows) {
    const rowValues = cols.map((c) => getCell(map, row, c));
    if (isTableHeaderRow(rowValues)) continue;

    for (const col of cols) {
      const label = getCell(map, row, col);
      if (!label || label.length > 200) continue;
      const labelScore = scoreLabelAgainstElement(label, element);
      if (labelScore < 0.45) continue;

      const immediate = collectImmediateRowValue(map, row, col);
      const valueParts = immediate ? [immediate] : [];
      const content = finalizeContentForElement(joinUniqueParts(valueParts), element);
      if (!content || isLikelyGanttHeaderRowContent(content)) continue;

      const confidence = labelScore * (labelScore >= 0.85 ? 1 : 0.9);
      if (confidence > best.confidence) {
        best = { content, confidence, method: "label_value_row" };
      }
    }
  }

  for (const col of cols) {
    for (const row of rows) {
      const label = getCell(map, row, col);
      if (!label || label.length > 200) continue;
      const labelScore = scoreLabelAgainstElement(label, element);
      if (labelScore < 0.45) continue;

      const below: string[] = [];
      for (let r = row + 1; r <= row + 8; r++) {
        const v = getCell(map, r, col);
        if (!v) {
          if (below.length > 0) break;
          continue;
        }
        if (scoreLabelAgainstElement(v, element) > 0.7 && below.length === 0) break;
        below.push(v);
      }
      const content = finalizeContentForElement(joinUniqueParts(below), element);
      if (!content || isLikelyGanttHeaderRowContent(content)) continue;

      const confidence = labelScore * 0.88;
      if (confidence > best.confidence) {
        best = { content, confidence, method: "label_value_col" };
      }
    }
  }

  for (const merge of sheet.merges) {
    const label = getCell(map, merge.startRow, merge.startCol);
    if (!label) continue;
    if (merge.startCol > 1 && label.length > 120) continue;
    if (!looksLikeFormLabel(label) && label.length > 100) continue;
    const labelScore = scoreLabelAgainstElement(label, element);
    if (labelScore < 0.45) continue;

    const rightCol = merge.endCol + 1;
    const rightParts: string[] = [];
    for (let r = merge.startRow; r <= merge.endRow; r++) {
      for (let c = rightCol; c <= rightCol + 3; c++) {
        const v = getCell(map, r, c);
        if (v) rightParts.push(v);
      }
    }

    let content = "";
    if (rightParts.length > 0) {
      content = joinUniqueParts(rightParts);
    } else {
      content = collectMergeContent(map, merge, merge.startRow, merge.startCol);
    }
    if (!content) {
      const belowParts: string[] = [];
      for (let r = merge.endRow + 1; r <= merge.endRow + 6; r++) {
        for (let c = merge.startCol; c <= merge.endCol; c++) {
          const v = getCell(map, r, c);
          if (v) belowParts.push(v);
        }
      }
      content = joinUniqueParts(belowParts);
    }
    content = finalizeContentForElement(content, element);
    if (!content || isLikelyGanttHeaderRowContent(content)) continue;

    const confidence = labelScore * 0.92;
    if (confidence > best.confidence) {
      best = { content, confidence, method: "merge_block" };
    }
  }

  const titleNorm = normalizeForMatch(element.title);
  if (titleNorm.length >= 4 && !isProjectNameElement(element) && !isFormRowElement(element)) {
    for (const cell of sheet.cells) {
      if (cell.col > 2 || !looksLikeFormLabel(cell.value)) continue;
      const cellNorm = normalizeForMatch(cell.value);
      if (!cellNorm.includes(titleNorm) && fuzzyMatchScore(cell.value, element.title) < 0.75) continue;

      const right = getCell(map, cell.row, cell.col + 1);
      const below = getCell(map, cell.row + 1, cell.col);
      const content = right || below;
      if (!content || normalizeForMatch(content) === titleNorm) continue;
      if (isLikelyGanttHeaderRowContent(content)) continue;

      const confidence = 0.78;
      if (confidence > best.confidence) {
        best = { content, confidence, method: "label_value_row" };
      }
    }
  }

  return applyContentQuality(best, element);
}

export function extractElementHeuristic(
  structuredFiles: ExcelStructuredData[],
  element: ElementDef
): HeuristicMatch {
  if (isProjectNameElement(element)) {
    const detected = detectProjectNameFromExcel(structuredFiles);
    if (detected && detected.score >= 42) {
      return applyContentQuality(
        {
          content: detected.text,
          confidence: Math.min(0.97, detected.score / 85),
          method: "project_title_cell",
        },
        element
      );
    }
    return { content: "", confidence: 0, method: "none" };
  }

  if (isSpecificObjectivesElement(element)) {
    const extracted = extractSpecificObjectivesFromExcel(structuredFiles);
    if (extracted) {
      return applyContentQuality(
        {
          content: extracted.content,
          confidence: extracted.confidence,
          method: "merge_block",
        },
        element
      );
    }
  }

  if (isObjectiveGeneralElement(element)) {
    const extracted = extractObjectiveGeneralFromExcel(structuredFiles);
    if (extracted) {
      return applyContentQuality(
        {
          content: extracted.content,
          confidence: extracted.confidence,
          method: "merge_block",
        },
        element
      );
    }
  }

  if (isFormRowElement(element)) {
    const extracted = extractFormRowFromExcel(structuredFiles, element);
    if (extracted) {
      return applyContentQuality(
        {
          content: extracted.content,
          confidence: extracted.confidence,
          method: "merge_block",
        },
        element
      );
    }
  }

  let best: HeuristicMatch = { content: "", confidence: 0, method: "none" };

  for (const file of structuredFiles) {
    const sheets = sortSheetsByPriority(file.sheets);

    for (const sheet of sheets) {
      const match = boostMatch(extractFromSheet(sheet, element), sheet.sheetName);
      if (match.confidence > best.confidence) {
        best = match;
      }
    }
  }

  return best;
}

export function extractAllElementsHeuristic(
  structuredFiles: ExcelStructuredData[],
  elements: ElementDef[]
): Map<string, HeuristicMatch> {
  const result = new Map<string, HeuristicMatch>();
  for (const el of elements) {
    result.set(el.title, extractElementHeuristic(structuredFiles, el));
  }
  return result;
}
