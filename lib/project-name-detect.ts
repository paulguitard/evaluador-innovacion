import type { ExcelStructuredData, ExcelSheet, ExcelCell } from "@/lib/excel-structured-extract";
import {
  isGanttColumnHeaderLabel,
  isLikelyGanttHeaderRowContent,
  isTableHeaderRow,
  parseProjectNameFromCellText,
  sheetPriorityScore,
} from "@/lib/excel-sheet-priority";
import {
  extractFromQaColumn,
  isQaColumnWorkbook,
  looksLikeFormPromptText,
} from "@/lib/qa-column-extract";

export type ProjectNameCandidate = {
  text: string;
  score: number;
  method: "top_prominent" | "wide_merge" | "labeled_prefix" | "text_lead";
};

const LABEL_LIKE =
  /^(nombre|objetivo|sede|escuela|carrera|correo|cargo|fecha|link|formulario|video|comuna|focalizaci)/i;

const NOISE_PATTERN =
  /^(https?:\/\/|www\.|@|%\s*de\s+avance|\d+\s*%$|bit[aá]cora|hoja:|fila\s+\d)/i;

/** Placeholders típicos de bitácoras IGIP (p. ej. valor de "ID VINCULAMOS"). */
const PLACEHOLDER_NAME =
  /^(no\s+registrad[ao]s?|n\/?a|s\/?d|sin\s+(registro|informaci[oó]n|dato)s?|pendiente|null|-|—|–)$/i;

/** Etiquetas de formulario / metadata, no títulos de proyecto. */
const FORM_FIELD_LABEL_NAME =
  /^(nombre\s+(del\s+)?(proyecto|emprendimiento)|modelo\s+de\s+negocio|descripci[oó]n\s+(del\s+)?(proyecto|emprendimiento|negocio)|id\s*vinculamos)$/i;

/** Etiquetas de columna A en filas metadata de "Resumen Proyecto" (IGIP). */
const IGIP_METADATA_LABEL =
  /^(id\s*vinculamos|nombre\s+encargado|cargo\s+encargado|correo\s+encargado|sedes?|escuelas?|carreras?|comunas?|socios?\s+comunitarios?|l[ií]nea)$/i;

function cleanDisplayName(raw: string): string {
  let t = raw.trim();
  const fromPrefix = parseProjectNameFromCellText(t);
  if (fromPrefix) return fromPrefix;
  t = t.replace(/^proyecto\s*:\s*/i, "").trim();
  t = t.replace(/\s*\([^)]{0,80}\)\s*$/, "").trim();
  return t;
}

function isInvalidProjectName(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 160) return true;
  if (NOISE_PATTERN.test(t)) return true;
  if (PLACEHOLDER_NAME.test(t)) return true;
  if (FORM_FIELD_LABEL_NAME.test(t)) return true;
  if (isGanttColumnHeaderLabel(t)) return true;
  if (isLikelyGanttHeaderRowContent(t)) return true;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (t.includes("@") && t.includes(".")) return true;
  if ((t.match(/\n/g) ?? []).length >= 2) return true;
  if (LABEL_LIKE.test(t) && t.length < 35 && !/proyecto/i.test(t)) return true;
  if (/^objetivo\s+(general|espec)/i.test(t)) return true;
  if (looksLikeFormPromptText(t)) return true;
  // Solo prompts imperativos explícitos; no rechazar títulos cortos que contengan
  // "negocio"/"proyecto" (p. ej. "Digitaliza tu negocio").
  if (/^(describe|indica|cu[eé]ntanos)\b/i.test(t)) return true;
  return false;
}

/** Valor a la derecha de una etiqueta metadata IGIP (no es el título del proyecto). */
function isIgipMetadataFieldValue(rowCells: ExcelCell[], cell: ExcelCell): boolean {
  if (cell.col <= 1) return false;
  const left = rowCells.find((c) => c.col === 1);
  if (!left) return false;
  return IGIP_METADATA_LABEL.test(left.value.trim());
}

function scoreTitleLikeText(
  text: string,
  opts: {
    row: number;
    mergeSpan?: number;
    sheetPriority: number;
    sheetIndex: number;
    isLongestInRow?: boolean;
    fromPrefix?: boolean;
  }
): number {
  const cleaned = cleanDisplayName(text);
  if (isInvalidProjectName(cleaned)) return 0;

  let score = 0;

  if (opts.row === 1) score += 48;
  else if (opts.row <= 3) score += 38;
  else if (opts.row <= 6) score += 26;
  else if (opts.row <= 12) score += 14;
  else if (opts.row <= 20) score += 6;

  const span = opts.mergeSpan ?? 1;
  if (span >= 4) score += 28;
  else if (span >= 3) score += 20;
  else if (span >= 2) score += 12;

  const len = cleaned.length;
  if (len >= 6 && len <= 90) score += 16;
  if (len >= 10 && len <= 55) score += 10;

  if (opts.isLongestInRow) score += 18;
  if (opts.sheetIndex === 0) score += 14;
  score += opts.sheetPriority * 0.22;
  if (opts.fromPrefix) score += 22;

  if (cleaned === cleaned.toUpperCase() && len < 50 && len > 8) score += 6;

  return score;
}

function mergeSpanAt(merges: ExcelSheet["merges"], row: number, col: number): number {
  for (const m of merges) {
    if (row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol) {
      return m.endCol - m.startCol + 1;
    }
  }
  return 1;
}

function isPrimaryMergeCell(merges: ExcelSheet["merges"], row: number, col: number): boolean {
  for (const m of merges) {
    if (row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol) {
      return m.startRow === row && m.startCol === col;
    }
  }
  return true;
}

function collectCandidatesFromSheet(sheet: ExcelSheet, sheetIndex: number): ProjectNameCandidate[] {
  const out: ProjectNameCandidate[] = [];
  const priority = sheetPriorityScore(sheet.sheetName);
  const rows = [...new Set(sheet.cells.map((c) => c.row))].sort((a, b) => a - b);
  const topRows = rows.filter((r) => r <= 20);

  for (const row of topRows) {
    const rowCells = sheet.cells.filter((c) => c.row === row);
    if (isTableHeaderRow(rowCells.map((c) => c.value))) continue;

    const validInRow = rowCells
      .map((c) => ({ cell: c, cleaned: cleanDisplayName(c.value) }))
      .filter(
        (x) =>
          !isInvalidProjectName(x.cleaned) &&
          !isIgipMetadataFieldValue(rowCells, x.cell)
      );
    const maxLen = validInRow.reduce((m, x) => Math.max(m, x.cleaned.length), 0);

    for (const { cell, cleaned } of validInRow) {
      if (!isPrimaryMergeCell(sheet.merges, cell.row, cell.col)) continue;

      const span = mergeSpanAt(sheet.merges, cell.row, cell.col);
      const fromPrefix = /proyecto\s*:/i.test(cell.value);
      const score = scoreTitleLikeText(cleaned, {
        row,
        mergeSpan: span,
        sheetPriority: priority,
        sheetIndex,
        isLongestInRow: cleaned.length === maxLen && maxLen > 0,
        fromPrefix,
      });

      if (score <= 0) continue;

      let method: ProjectNameCandidate["method"] = "top_prominent";
      if (fromPrefix) method = "labeled_prefix";
      else if (span >= 3) method = "wide_merge";

      out.push({ text: cleaned, score, method });
    }
  }

  return out;
}

/**
 * Detecta el nombre del proyecto en Excel: texto más arriba y/o más prominente
 * (filas superiores, celdas fusionadas anchas, mayor longitud en la fila).
 */
function detectProjectNameFromQaColumn(
  structuredFiles: ExcelStructuredData[]
): ProjectNameCandidate | null {
  if (!isQaColumnWorkbook(structuredFiles)) return null;

  const extracted = extractFromQaColumn(structuredFiles, {
    title: "Nombre del proyecto",
    description: "Nombre del emprendimiento o proyecto",
  });
  if (!extracted?.content || extracted.confidence < 0.7) return null;

  return {
    text: extracted.content,
    score: 95 + extracted.confidence * 10,
    method: "labeled_prefix",
  };
}

export function detectProjectNameFromExcel(
  structuredFiles: ExcelStructuredData[]
): ProjectNameCandidate | null {
  const fromQa = detectProjectNameFromQaColumn(structuredFiles);
  if (fromQa) return fromQa;

  let best: ProjectNameCandidate | null = null;

  for (const file of structuredFiles) {
    file.sheets.forEach((sheet, sheetIndex) => {
      for (const c of collectCandidatesFromSheet(sheet, sheetIndex)) {
        if (!best || c.score > best.score) best = c;
      }
    });
  }

  return best;
}

/**
 * Desde texto plano (PDF/Word/chunks): primeras líneas con apariencia de título.
 */
export function detectProjectNameFromText(fullText: string): ProjectNameCandidate | null {
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40);

  let best: ProjectNameCandidate | null = null;

  for (let i = 0; i < lines.length; i++) {
    const cleaned = cleanDisplayName(lines[i]);
    if (isInvalidProjectName(cleaned)) continue;

    const row = i + 1;
    const score = scoreTitleLikeText(cleaned, {
      row,
      mergeSpan: 1,
      sheetPriority: 70,
      sheetIndex: 0,
      isLongestInRow: true,
      fromPrefix: /proyecto\s*:/i.test(lines[i]),
    });

    if (score <= 0) continue;
    const candidate: ProjectNameCandidate = {
      text: cleaned,
      score: score + (lines.length - i) * 0.5,
      method: "text_lead",
    };
    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

export function detectProjectName(
  structuredFiles: ExcelStructuredData[],
  plainTexts: string[] = []
): ProjectNameCandidate | null {
  let best = detectProjectNameFromExcel(structuredFiles);

  for (const text of plainTexts) {
    const fromText = detectProjectNameFromText(text);
    if (fromText && (!best || fromText.score > best.score)) best = fromText;
  }

  return best;
}
