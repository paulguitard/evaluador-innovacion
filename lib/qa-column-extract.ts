import type { ExcelSheet, ExcelStructuredData } from "@/lib/excel-structured-extract";
import type { ElementDef } from "@/lib/excel-heuristics";
import { fuzzyMatchScore, normalizeForMatch } from "@/lib/text-match";
import { looksLikeFormLabel } from "@/lib/form-row-extract";
import {
  isAcceptableExtractedContent,
  looksLikeFormQuestionContent,
} from "@/lib/extract-content-quality";
import { isProjectNameElement } from "@/lib/excel-sheet-priority";

const QA_LABEL_COL = 1;
const QA_VALUE_COL = 2;

function buildCellMap(cells: ExcelSheet["cells"]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of cells) {
    map.set(`${c.row},${c.col}`, c.value.trim());
  }
  return map;
}

function getCell(map: Map<string, string>, row: number, col: number): string {
  return map.get(`${row},${col}`) ?? "";
}

/** Texto de etiqueta/pregunta de formulario (incluye imperativos sin signo de interrogación). */
export function looksLikeFormPromptText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeFormQuestionContent(t)) return true;
  if (/^(describe|indica|cu[eé]ntanos|debe ser|acerca de|de acuerdo)/i.test(t)) return true;
  if (/\b(cu[aá]l|qu[eé])\s+es\b/i.test(t) && t.length < 180) return true;
  if (/\b(cu[aá]l|qu[eé])\s+(problema|soluci|segmento|avance)/i.test(t)) return true;
  return false;
}

/** Etiqueta típica de formulario IMET: pregunta explícita o imperativo. */
function isQuestionLikeLabel(label: string): boolean {
  return looksLikeFormPromptText(label) || /\?/.test(label);
}

export function isQaColumnSheet(sheet: ExcelSheet): boolean {
  const rowNums = [...new Set(sheet.cells.map((c) => c.row))].sort((a, b) => a - b);
  let paired = 0;
  let questionLike = 0;

  const map = buildCellMap(sheet.cells);
  for (const row of rowNums) {
    const label = getCell(map, row, QA_LABEL_COL);
    const value = getCell(map, row, QA_VALUE_COL);
    if (!label || !value || value.length < 3) continue;
    paired++;
    if (isQuestionLikeLabel(label) && !looksLikeFormQuestionContent(value)) {
      questionLike++;
    }
  }

  return paired >= 4 && questionLike >= 3 && questionLike / paired >= 0.55;
}

export function isQaColumnWorkbook(files: ExcelStructuredData[]): boolean {
  return files.some((f) => f.sheets.some(isQaColumnSheet));
}

function scoreQaLabelMatch(label: string, element: ElementDef): number {
  const labelN = normalizeForMatch(label);
  const titleN = normalizeForMatch(element.title);
  const combined = `${titleN} ${normalizeForMatch(element.description ?? "")}`;

  if (isProjectNameElement(element)) {
    if (/nombre/.test(labelN) && /(emprendimiento|proyecto|negocio)/.test(labelN)) return 0.98;
    return Math.min(fuzzyMatchScore(label, element.title), 0.4);
  }

  if (combined.includes("origen") && /(surge|origen|idea de negocio)/.test(labelN)) return 0.93;
  if (combined.includes("descripci") && /describe brevemente|descripci.*emprendimiento/.test(labelN)) {
    return 0.93;
  }
  if (combined.includes("avance") && /avance/.test(labelN)) return 0.93;
  if (combined.includes("validaci") && /validaci|entrevistas|conversaciones|usuarios/.test(labelN)) {
    return 0.9;
  }
  if (combined.includes("segmento") && /segmento|dirigida|clientes/.test(labelN)) return 0.9;
  if (combined.includes("modelo") && /(ingresos|modelo de negocio|generar ingresos)/.test(labelN)) {
    return 0.9;
  }
  if (combined.includes("componente tecnol") && /componente tecnol|tecnolog/.test(labelN)) return 0.9;
  if (
    (combined.includes("problema") || combined.includes("necesidad") || combined.includes("oportunidad")) &&
    /(problema|necesidad|oportunidad)/.test(labelN)
  ) {
    return 0.9;
  }
  if (/^solucion$/.test(titleN) || titleN.startsWith("solucion ")) {
    if (/solucion/.test(labelN) && /ofrecen|resuelven|solucion/.test(labelN)) return 0.88;
  }

  const titleScore = fuzzyMatchScore(label, element.title);
  const descScore = element.description ? fuzzyMatchScore(label, element.description) * 0.75 : 0;

  if (titleN.includes("soluci") && /solucion/.test(labelN)) {
    return Math.max(titleScore, descScore, 0.82);
  }

  const titleTokens = titleN.split(" ").filter((tok) => tok.length >= 4);
  if (titleTokens.length > 0) {
    const hits = titleTokens.filter((tok) => labelN.includes(tok)).length;
    const tokenScore = hits / titleTokens.length;
    if (tokenScore >= 0.5) return Math.max(titleScore, descScore, 0.7 + tokenScore * 0.2);
  }

  return Math.max(titleScore, descScore);
}

export function cleanProjectNameFromAnswer(raw: string): string {
  let t = raw.trim();
  const prefixRes = [
    /^el nombre de (mi |nuestro )?(proyecto|emprendimiento|negocio) es\s+/i,
    /^(mi |nuestro )?(proyecto|emprendimiento) se llama\s+/i,
    /^se llama\s+/i,
    /^nombre:\s*/i,
  ];
  for (const re of prefixRes) {
    t = t.replace(re, "").trim();
  }

  const firstSentence = t.split(/[.!?]/)[0]?.trim() ?? t;
  if (firstSentence.length > 0 && firstSentence.length <= 90) return firstSentence;
  return t.slice(0, 90).trim();
}

function cleanQaAnswer(raw: string, element: ElementDef): string {
  const t = raw.trim();
  if (!t) return t;
  if (isProjectNameElement(element)) return cleanProjectNameFromAnswer(t);
  return t;
}

function extractFromSheet(sheet: ExcelSheet, element: ElementDef): { content: string; confidence: number } | null {
  if (!isQaColumnSheet(sheet)) return null;

  const map = buildCellMap(sheet.cells);
  const rowNums = [...new Set(sheet.cells.map((c) => c.row))].sort((a, b) => a - b);

  let best = "";
  let bestScore = 0;

  for (const row of rowNums) {
    const label = getCell(map, row, QA_LABEL_COL);
    const value = getCell(map, row, QA_VALUE_COL);
    if (!label || !value || value.length < 2) continue;
    if (looksLikeFormQuestionContent(value)) continue;

    const labelScore = scoreQaLabelMatch(label, element);
    if (labelScore < 0.52) continue;

    const answer = cleanQaAnswer(value, element);
    if (answer.length < 2) continue;
    if (normalizeForMatch(answer) === normalizeForMatch(label)) continue;
    if (looksLikeFormPromptText(answer)) continue;
    if (!isAcceptableExtractedContent(element, answer)) continue;

    if (labelScore > bestScore) {
      bestScore = labelScore;
      best = answer;
    }
  }

  if (!best || bestScore < 0.52) return null;
  return { content: best, confidence: Math.min(0.97, bestScore) };
}

export function extractFromQaColumn(
  structuredFiles: ExcelStructuredData[],
  element: ElementDef
): { content: string; confidence: number } | null {
  if (!isQaColumnWorkbook(structuredFiles)) return null;

  let best: { content: string; confidence: number } | null = null;

  for (const file of structuredFiles) {
    for (const sheet of file.sheets) {
      const match = extractFromSheet(sheet, element);
      if (match && (!best || match.confidence > best.confidence)) {
        best = match;
      }
    }
  }

  return best;
}
