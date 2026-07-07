import type { ExcelSheet, ExcelStructuredData, ExcelMerge } from "@/lib/excel-structured-extract";
import type { ElementDef } from "@/lib/excel-heuristics";
import { fuzzyMatchScore, normalizeForMatch } from "@/lib/text-match";
import { joinUniqueParts, splitContinuityFromInnovatorTail } from "@/lib/extract-content-clean";
import {
  isAcceptableExtractedContent,
  isFocalizacionKeywordList,
  looksLikeFormQuestionContent,
} from "@/lib/extract-content-quality";
import { sheetsForElement } from "@/lib/sheet-element-routing";

type ElementLike = { title: string; description?: string };

const LABEL_MAX_CHARS = 220;
const VALUE_MIN_COL = 2;

const CONTINUITY_LABEL_RE =
  /continuidad.*fase\s+anterior|fase\s+anterior.*continuidad|es\s+continuidad\s+de/i;
const FACTOR_INNOVADOR_LABEL_RE =
  /factor\s+innovador|innovador\s+del\s+proyecto|diferenciaci[oó]n.*propuesta\s+de\s+valor/i;
const PERTINENCIA_COMBINED_LABEL_RE =
  /pertinencia\s+local.*disciplinar|pertinencia\s+local\s+y\s+disciplinar|local\s+y\s+disciplinar/i;
const PERTINENCIA_LOCAL_INLINE_RE = /pertinencia\s+local\s*:?\s*/i;
const PERTINENCIA_DISCIPLINAR_INLINE_RE = /pertinencia\s+disciplinar\s*:?\s*/i;
/** Encabezados abreviados dentro del valor de celda fusionada (p. ej. "Local: … Disciplinar: …"). */
const LOCAL_SHORT_HEADER_RE = /(?:^|[\n.])\s*Local\s*:\s*/i;
const DISCIPLINAR_SHORT_HEADER_RE = /\bDisciplinar\s*:\s*/i;
const FORM_ROW_TITLE_PATTERNS = [
  /necesidad|problema|oportunidad/,
  /publico\s+objetivo/,
  /perspectiva\s+de\s+genero|\bgenero\b/,
  /en\s+que\s+consiste|consiste\s+la\s+solucion/,
  /ejes?\s+de\s+impacto|focalizaci/,
  /sostenibilidad/,
  /objetivo\s+de\s+desarrollo\s+sostenible|\bods\b/,
  /resultados.*contribuci|contribuci.*esperada/,
  /metodolog.*medici|medici.*resultado/,
  /factor\s+innovador|innovador\s+del\s+proyecto/,
  /escalabilidad/,
  /financiamiento/,
  /metodolog/,
  /justificaci/,
  /plan\s+de\s+trabajo/,
  /descripci.*solucion/,
  /origen de la idea|surge.*idea/,
  /avance actual|nivel de avance/,
  /descripci.*emprendimiento/,
  /segmento de clientes/,
  /validaci.*clientes/,
  /modelo de negocio/,
  /componente tecnol/,
  /\bsoluci[oó]n\b/,
];

export function isContinuityElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return t.includes("continuidad") && t.includes("fase");
}

export function isFactorInnovadorElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return /factor\s+innovador|innovador\s+del\s+proyecto/.test(t);
}

export function isPertinenciaLocalElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return t.includes("pertinencia") && t.includes("local") && !t.includes("disciplinar");
}

export function isPertinenciaDisciplinarElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return t.includes("pertinencia") && t.includes("disciplinar");
}

export function isFormRowElement(element: ElementLike): boolean {
  if (
    isContinuityElement(element) ||
    isPertinenciaLocalElement(element) ||
    isPertinenciaDisciplinarElement(element)
  ) {
    return true;
  }
  const t = normalizeForMatch(`${element.title} ${element.description ?? ""}`);
  return FORM_ROW_TITLE_PATTERNS.some((re) => re.test(t));
}

/** @deprecated Usar isFormRowElement */
export function isVerbatimNarrativeElement(element: ElementLike): boolean {
  return isFormRowElement(element);
}

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

function collectRowValue(map: Map<string, string>, row: number, fromCol: number): string {
  const parts: string[] = [];
  for (let c = fromCol; c <= fromCol + 8; c++) {
    const v = getCell(map, row, c);
    if (v) parts.push(v);
  }
  return joinUniqueParts(parts);
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

function findMergeAt(merges: ExcelMerge[], row: number, col: number): ExcelMerge | null {
  return (
    merges.find(
      (m) => row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol
    ) ?? null
  );
}

function collectRowValueWithMerges(
  map: Map<string, string>,
  merges: ExcelMerge[],
  row: number,
  fromCol: number
): string {
  const parts: string[] = [];
  const seenMerges = new Set<string>();

  for (let c = fromCol; c <= fromCol + 8; c++) {
    const merge = findMergeAt(merges, row, c);
    if (merge) {
      const key = `${merge.startRow},${merge.startCol},${merge.endRow},${merge.endCol}`;
      if (seenMerges.has(key)) continue;
      seenMerges.add(key);
      const text = collectMergeContent(map, merge);
      if (text) parts.push(text);
      continue;
    }
    const v = getCell(map, row, c);
    if (v) parts.push(v);
  }
  return joinUniqueParts(parts);
}

/** Recoge respuesta en la misma fila o en filas siguientes hasta la próxima etiqueta. */
function collectFormAnswer(
  map: Map<string, string>,
  merges: ExcelMerge[],
  labelCell: { row: number; col: number; value: string },
  labelCells: ExcelSheet["cells"]
): string {
  const sameRow = collectRowValueWithMerges(map, merges, labelCell.row, labelCell.col + 1);
  let answer = toAnswerOnly(sameRow, labelCell.value);

  if (answer.length >= 40 && !looksLikeFormQuestionContent(answer)) {
    return answer;
  }

  const snippetLines: string[] = [];
  for (let r = labelCell.row; r <= labelCell.row + 12; r++) {
    const rowText = collectRowValueWithMerges(map, merges, r, labelCell.col + 1);
    if (!rowText) continue;
    if (r > labelCell.row) {
      const labelInRow = labelCells.find((c) => c.row === r && c.col <= labelCell.col + 1);
      if (labelInRow && labelInRow.row !== labelCell.row && looksLikeFormLabel(labelInRow.value)) {
        break;
      }
    }
    snippetLines.push(rowText);
  }

  const combined = toAnswerOnly(joinUniqueParts(snippetLines), labelCell.value);
  if (combined.length > answer.length && !looksLikeFormQuestionContent(combined)) {
    return combined;
  }

  return answer.length > sameRow.length ? answer : sameRow;
}

export function looksLikeFormLabel(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > LABEL_MAX_CHARS) return false;
  if (t.includes("?") || t.includes("¿")) return true;
  if (t.endsWith(":")) return true;
  if (t.length > 100) return false;
  if (t.endsWith(".")) return true;
  return t.length <= 80;
}

function scoreLabelMatch(label: string, element: ElementLike): number {
  const labelNorm = normalizeForMatch(label);
  const titleNorm = normalizeForMatch(element.title);
  if (!titleNorm) return 0;

  if (/ejes?\s+de\s+impacto|focalizaci/.test(titleNorm) && /^focalizaci[oó]n$/.test(labelNorm)) {
    return 0.1;
  }

  if (/escalabilidad/i.test(titleNorm) && /expandir|adopci|replicar|escalar|estrategia/i.test(labelNorm)) {
    return 0.88;
  }

  if (/sostenibilidad/i.test(titleNorm) && /sostenibilidad/i.test(labelNorm)) {
    return 0.9;
  }

  if (/objetivo de desarrollo sostenible|\bods\b/i.test(titleNorm) && /desarrollo sostenible|\bods\b/i.test(labelNorm)) {
    return 0.88;
  }

  if (/factor innovador|innovador del proyecto/i.test(titleNorm)) {
    if (CONTINUITY_LABEL_RE.test(labelNorm)) return 0;
    if (FACTOR_INNOVADOR_LABEL_RE.test(labelNorm)) return 0.95;
    if (/innovador/i.test(labelNorm) && !/continuidad|fase\s+anterior/.test(labelNorm)) {
      return 0.55;
    }
    return 0;
  }

  if (labelNorm.includes(titleNorm)) return 0.95;
  if (titleNorm.includes(labelNorm) && labelNorm.length > 8) return 0.88;

  const titleTokens = titleNorm.split(" ").filter((tok) => tok.length >= 4);
  if (titleTokens.length > 0) {
    const hits = titleTokens.filter((tok) => labelNorm.includes(tok)).length;
    const tokenScore = hits / titleTokens.length;
    if (tokenScore >= 0.6) return 0.72 + tokenScore * 0.2;
  }

  return fuzzyMatchScore(label, element.title);
}

function extractGenericFormRow(
  element: ElementLike,
  labelCells: ExcelSheet["cells"],
  map: Map<string, string>,
  merges: ExcelMerge[]
): string {
  let best = "";
  let bestScore = 0;

  for (const labelCell of labelCells) {
    const score = scoreLabelMatch(labelCell.value, element);
    if (score < 0.52) continue;

    const rowValue = collectFormAnswer(map, merges, labelCell, labelCells);
    if (rowValue.length < 25) continue;

    const answer = toAnswerOnly(rowValue, labelCell.value);
    if (answer.length < 15) continue;
    if (looksLikeFormQuestionContent(answer)) continue;
    if (isFocalizacionKeywordList(answer) && /ejes?\s+de\s+impacto|focalizaci/i.test(element.title)) continue;
    if (normalizeForMatch(answer) === normalizeForMatch(labelCell.value)) continue;
    if (looksLikeFormLabel(answer)) continue;

    if (score > bestScore) {
      bestScore = score;
      best = answer;
    }
  }

  return best;
}

function stripEmbeddedLabel(value: string, label: string): string {
  let v = value.trim();
  const l = label.trim();
  if (!v) return v;

  if (l && v.startsWith(l)) {
    v = v.slice(l.length).replace(/^[\s.:?¿]+/, "").trim();
  } else if (l) {
    const vn = normalizeForMatch(v);
    const ln = normalizeForMatch(l);
    if (vn.startsWith(ln) && l.length > 10) {
      v = v.slice(l.length).replace(/^[\s.:?¿]+/, "").trim();
    }
  }

  return v;
}

/** Quita preguntas de formulario solo al inicio; no recorta el cuerpo de la respuesta. */
function stripLeadingFormQuestions(text: string): string {
  const v = text.trim();
  if (!v) return v;

  const prefixWindow = Math.min(450, Math.max(120, Math.floor(v.length * 0.4)));
  const head = v.slice(0, prefixWindow);

  const answerStartMarkers = [
    /\b(S[ií],?\s+este\s+proyecto\b)/i,
    /\b(S[ií],?\s+el\s+proyecto\b)/i,
    /\b(No,?\s+es\s+)/i,
    /\b(No,)\s/i,
  ];
  for (const re of answerStartMarkers) {
    const m = head.match(re);
    if (m?.index != null) {
      if (m.index === 0) return v;
      if (m.index < prefixWindow) return v.slice(m.index).trim();
    }
  }

  const qMarks = [...head.matchAll(/[?¿]/g)];
  if (qMarks.length > 0) {
    const last = qMarks[qMarks.length - 1];
    if (last.index != null && last.index < prefixWindow - 5) {
      const after = v.slice(last.index + 1).trim();
      if (after.length > 20) return after;
    }
  }

  return v;
}

function toAnswerOnly(value: string, label: string): string {
  let v = stripEmbeddedLabel(value, label);
  v = stripLeadingFormQuestions(v);
  return v.trim();
}
function findDisciplinarBoundary(text: string): number {
  const candidates: number[] = [];
  const full = text.match(PERTINENCIA_DISCIPLINAR_INLINE_RE);
  if (full?.index != null && full.index > 0) candidates.push(full.index);
  const short = text.match(DISCIPLINAR_SHORT_HEADER_RE);
  if (short?.index != null && short.index > 0) candidates.push(short.index);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function findLocalContentStart(text: string): number {
  const full = text.match(PERTINENCIA_LOCAL_INLINE_RE);
  if (full?.index != null) return full.index + full[0].length;
  const short = text.match(LOCAL_SHORT_HEADER_RE);
  if (short?.index != null) return short.index + short[0].length;
  return 0;
}

function splitPertinenciaLocal(text: string, label = ""): string {
  const t = text.trim();
  if (!t) return "";

  const discIdx = findDisciplinarBoundary(t);
  const localStart = findLocalContentStart(t);

  if (discIdx > localStart) {
    return t.slice(localStart, discIdx).replace(/^y\s+disciplinar\.?\s*/i, "").trim();
  }

  const localMatch = t.match(PERTINENCIA_LOCAL_INLINE_RE);
  if (localMatch?.index != null) {
    let slice = t.slice(localMatch.index + localMatch[0].length);
    if (discIdx > localMatch.index) {
      slice = t.slice(localMatch.index + localMatch[0].length, discIdx);
    }
    return slice.replace(/^y\s+disciplinar\.?\s*/i, "").trim();
  }

  if (discIdx > 0) {
    return t
      .slice(0, discIdx)
      .replace(/^pertinencia\s+local\s+y\s+disciplinar\.?\s*/i, "")
      .trim();
  }

  return toAnswerOnly(t, label);
}

function splitPertinenciaDisciplinar(text: string): string {
  const t = text.trim();
  if (!t) return "";

  const full = t.match(PERTINENCIA_DISCIPLINAR_INLINE_RE);
  if (full?.index != null) return t.slice(full.index + full[0].length).trim();

  const short = t.match(DISCIPLINAR_SHORT_HEADER_RE);
  if (short?.index != null) return t.slice(short.index + short[0].length).trim();

  return "";
}

function rowValueHasCombinedPertinencia(value: string): boolean {
  return findDisciplinarBoundary(value) > 0;
}

function extractFromSheet(sheet: ExcelSheet, element: ElementLike): string {
  const map = buildCellMap(sheet.cells);
  const merges = sheet.merges ?? [];
  const labelCells = sheet.cells
    .filter((c) => c.col <= VALUE_MIN_COL && looksLikeFormLabel(c.value))
    .sort((a, b) => a.row - b.row);

  for (const labelCell of labelCells) {
    const labelNorm = normalizeForMatch(labelCell.value);
    const rowValue = collectFormAnswer(map, merges, labelCell, labelCells);
    if (!rowValue || rowValue.length < 15) continue;
    if (looksLikeFormQuestionContent(rowValue)) continue;

    if (isContinuityElement(element) && CONTINUITY_LABEL_RE.test(labelNorm)) {
      return splitContinuityFromInnovatorTail(toAnswerOnly(rowValue, labelCell.value));
    }

    if (isFactorInnovadorElement(element) && FACTOR_INNOVADOR_LABEL_RE.test(labelNorm)) {
      if (CONTINUITY_LABEL_RE.test(labelNorm)) continue;
      return toAnswerOnly(rowValue, labelCell.value);
    }

    if (
      (isPertinenciaLocalElement(element) || isPertinenciaDisciplinarElement(element)) &&
      (PERTINENCIA_COMBINED_LABEL_RE.test(labelNorm) || rowValueHasCombinedPertinencia(rowValue))
    ) {
      if (isPertinenciaLocalElement(element)) {
        const local = splitPertinenciaLocal(rowValue, labelCell.value);
        if (local.length > 15) return local;
      }
      if (isPertinenciaDisciplinarElement(element)) {
        const disc = splitPertinenciaDisciplinar(rowValue);
        if (disc.length > 15) return disc;
      }
    }

    if (isPertinenciaLocalElement(element) && /^pertinencia\s+local\b/.test(labelNorm)) {
      return toAnswerOnly(rowValue, labelCell.value);
    }

    if (isPertinenciaDisciplinarElement(element) && /^pertinencia\s+disciplinar\b/.test(labelNorm)) {
      return toAnswerOnly(rowValue, labelCell.value);
    }
  }

  if (
    isFormRowElement(element) &&
    !isContinuityElement(element) &&
    !isPertinenciaLocalElement(element) &&
    !isPertinenciaDisciplinarElement(element)
  ) {
    return extractGenericFormRow(element, labelCells, map, merges);
  }

  return "";
}

export function extractFormRowFromExcel(
  structuredFiles: ExcelStructuredData[],
  element: ElementLike
): { content: string; confidence: number } | null {
  if (!isFormRowElement(element)) return null;

  for (const file of structuredFiles) {
    const orderedSheets = sheetsForElement(element as ElementDef, file.sheets);
    for (const sheet of orderedSheets) {
      const content = extractFromSheet(sheet, element);
      if (content.length > 20 && isAcceptableExtractedContent(element as ElementDef, content)) {
        return { content, confidence: 0.94 };
      }
    }
  }
  return null;
}
