import type { ExcelStructuredData } from "@/lib/excel-structured-extract";
import type { ElementDef } from "@/lib/excel-heuristics";
import { fuzzyMatchScore, normalizeForMatch } from "@/lib/hybrid-search";
import { loadProjectChunks } from "@/lib/project-vector-store";
import type { StoredChunk } from "@/lib/vector-store";
import {
  isGanttColumnHeaderLabel,
  isLikelyGanttHeaderRowContent,
  isProjectNameElement,
  isTableHeaderRow,
  sheetPriorityScore,
  sortSheetsByPriority,
} from "@/lib/excel-sheet-priority";
import {
  detectProjectName,
  detectProjectNameFromExcel,
  detectProjectNameFromText,
} from "@/lib/project-name-detect";
import { deduplicateExtractedContent, finalizeContentForElement, joinUniqueParts } from "@/lib/extract-content-clean";
import {
  extractSpecificObjectivesFromExcel,
  isSpecificObjectivesElement,
} from "@/lib/objective-extract";
import { extractFormRowFromExcel, isFormRowElement } from "@/lib/form-row-extract";

function queryTokens(element: ElementDef): string[] {
  const combined = `${element.title} ${element.description}`;
  return normalizeForMatch(combined)
    .split(" ")
    .filter((t) => t.length >= 4);
}

function scoreTextAgainstElement(text: string, element: ElementDef): number {
  if (isGanttColumnHeaderLabel(text)) return 0;
  const titleScore = fuzzyMatchScore(text, element.title);
  const descScore = element.description ? fuzzyMatchScore(text, element.description) * 0.7 : 0;
  const tokens = queryTokens(element);
  const norm = normalizeForMatch(text);
  let tokenHits = 0;
  for (const t of tokens) {
    if (norm.includes(t)) tokenHits += 1;
  }
  const tokenScore = tokens.length > 0 ? tokenHits / tokens.length : 0;
  return Math.max(titleScore, descScore, tokenScore);
}

/**
 * Búsqueda por keywords en celdas Excel: localiza etiqueta y recoge valor adyacente.
 */
export function keywordScanExcel(
  structuredFiles: ExcelStructuredData[],
  element: ElementDef
): string {
  if (isProjectNameElement(element)) {
    const detected = detectProjectNameFromExcel(structuredFiles);
    if (detected) return detected.text;
    return "";
  }

  if (isSpecificObjectivesElement(element)) {
    const extracted = extractSpecificObjectivesFromExcel(structuredFiles);
    if (extracted) return extracted.content;
    return "";
  }

  if (isFormRowElement(element)) {
    const extracted = extractFormRowFromExcel(structuredFiles, element);
    if (extracted) return extracted.content;
    return "";
  }

  let bestContent = "";
  let bestScore = 0;

  for (const file of structuredFiles) {
    const sheets = sortSheetsByPriority(file.sheets);

    for (const sheet of sheets) {

      const cellMap = new Map(sheet.cells.map((c) => [`${c.row},${c.col}`, c]));
      const rows = [...new Set(sheet.cells.map((c) => c.row))];

      for (const row of rows) {
        const rowCells = sheet.cells.filter((c) => c.row === row);
        if (isTableHeaderRow(rowCells.map((c) => c.value))) continue;

        for (const cell of rowCells) {
          const labelScore = scoreTextAgainstElement(cell.value, element);
          if (labelScore < 0.45) continue;

          const valueParts: string[] = [];
          for (let c = cell.col + 1; c <= cell.col + 5; c++) {
            const neighbor = cellMap.get(`${cell.row},${c}`);
            if (neighbor?.value.trim()) valueParts.push(neighbor.value.trim());
            else if (valueParts.length > 0) break;
          }
          if (valueParts.length === 0) {
            for (let r = cell.row + 1; r <= cell.row + 10; r++) {
              const below = cellMap.get(`${r},${cell.col}`);
              if (!below?.value.trim()) {
                if (valueParts.length > 0) break;
                continue;
              }
              if (scoreTextAgainstElement(below.value, element) > 0.75 && valueParts.length === 0) break;
              valueParts.push(below.value.trim());
            }
          }

          const content = finalizeContentForElement(joinUniqueParts(valueParts), element);
          if (!content || isLikelyGanttHeaderRowContent(content)) continue;
          const priority = sheetPriorityScore(sheet.sheetName) / 100;
          const score = labelScore * Math.min(1, content.length / 40) * (0.4 + 0.6 * priority);
          if (score > bestScore) {
            bestScore = score;
            bestContent = content;
          }
        }
      }
    }
  }

  return bestContent;
}

function extractSnippetAroundMatch(text: string, element: ElementDef): string {
  const normTitle = normalizeForMatch(element.title);
  const lines = text.split(/\r?\n/);
  let matchIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (scoreTextAgainstElement(line, element) >= 0.5) {
      matchIdx = i;
      break;
    }
    if (normTitle.length >= 4 && normalizeForMatch(line).includes(normTitle)) {
      matchIdx = i;
      break;
    }
  }

  if (matchIdx < 0) return "";

  const snippetLines: string[] = [];
  const matchLine = lines[matchIdx].trim();
  const sep = matchLine.includes(":") ? ":" : matchLine.includes("|") ? "|" : null;
  if (sep) {
    const after = matchLine.split(sep).slice(1).join(sep).trim();
    if (after.length > 10) snippetLines.push(after);
  }

  for (let i = matchIdx + 1; i < Math.min(lines.length, matchIdx + 25); i++) {
    const line = lines[i].trim();
    if (!line) {
      if (snippetLines.length > 0) break;
      continue;
    }
    if (/^[A-ZÁÉÍÓÚÑ][^:]{2,40}:$/i.test(line) && snippetLines.length > 2) break;
    snippetLines.push(line);
  }

  return snippetLines.join("\n").trim();
}

/**
 * Búsqueda por keywords en chunks indexados del proyecto (sin embeddings).
 */
export function keywordScanChunks(chunks: StoredChunk[], element: ElementDef): string {
  let bestContent = "";
  let bestScore = 0;

  for (const chunk of chunks) {
    const score = scoreTextAgainstElement(chunk.text, element);
    if (score < 0.35) continue;

    const snippet = extractSnippetAroundMatch(chunk.text, element);
    const content = snippet || chunk.text.slice(0, 3000);
    const combinedScore = score * Math.min(1, content.length / 50);
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestContent = content;
    }
  }

  return bestContent;
}

export function keywordScanProject(
  sessionId: string,
  structuredFiles: ExcelStructuredData[],
  element: ElementDef
): string {
  if (isProjectNameElement(element)) {
    const chunks = loadProjectChunks(sessionId);
    const plainFromChunks = chunks.slice(0, 5).map((c) => c.text);
    const detected = detectProjectName(structuredFiles, plainFromChunks);
    if (detected) return detected.text;
    for (const c of chunks.slice(0, 8)) {
      const fromText = detectProjectNameFromText(c.text);
      if (fromText) return fromText.text;
    }
    return "";
  }

  const excelHit = structuredFiles.length > 0 ? keywordScanExcel(structuredFiles, element) : "";

  if (isFormRowElement(element)) {
    return excelHit;
  }

  const chunks = loadProjectChunks(sessionId);
  const chunkHit = chunks.length > 0 ? keywordScanChunks(chunks, element) : "";

  if (excelHit.length >= chunkHit.length) return excelHit;
  return chunkHit;
}
