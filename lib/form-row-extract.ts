import type { ExcelSheet, ExcelStructuredData } from "@/lib/excel-structured-extract";
import { fuzzyMatchScore, normalizeForMatch } from "@/lib/hybrid-search";
import { joinUniqueParts } from "@/lib/extract-content-clean";
import { sortSheetsByPriority } from "@/lib/excel-sheet-priority";

type ElementLike = { title: string; description?: string };

const LABEL_MAX_CHARS = 220;
const VALUE_MIN_COL = 2;

const CONTINUITY_LABEL_RE =
  /continuidad.*fase\s+anterior|fase\s+anterior.*continuidad|es\s+continuidad\s+de/i;
const PERTINENCIA_COMBINED_LABEL_RE = /pertinencia\s+local.*disciplinar|pertinencia\s+local\s+y\s+disciplinar/i;
const PERTINENCIA_LOCAL_INLINE_RE = /pertinencia\s+local\s*:?\s*/i;
const PERTINENCIA_DISCIPLINAR_INLINE_RE = /pertinencia\s+disciplinar\s*:?\s*/i;
const FORM_ROW_TITLE_PATTERNS = [
  /necesidad|problema|oportunidad/,
  /publico\s+objetivo/,
  /perspectiva\s+de\s+genero|\bgenero\b/,
  /en\s+que\s+consiste|consiste\s+la\s+solucion/,
  /ejes?\s+de\s+impacto/,
  /financiamiento/,
  /metodolog/,
  /justificaci/,
  /plan\s+de\s+trabajo/,
  /descripci.*solucion/,
];

export function isContinuityElement(element: ElementLike): boolean {
  const t = normalizeForMatch(element.title);
  return t.includes("continuidad") && t.includes("fase");
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
  for (let c = fromCol; c <= fromCol + 6; c++) {
    const v = getCell(map, row, c);
    if (v) parts.push(v);
  }
  return joinUniqueParts(parts);
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
  map: Map<string, string>
): string {
  let best = "";
  let bestScore = 0;

  for (const labelCell of labelCells) {
    const score = scoreLabelMatch(labelCell.value, element);
    if (score < 0.52) continue;

    const rowValue = collectRowValue(map, labelCell.row, labelCell.col + 1);
    if (rowValue.length < 25) continue;

    const answer = toAnswerOnly(rowValue, labelCell.value);
    if (answer.length < 40) continue;
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
function splitPertinenciaLocal(text: string, label = ""): string {
  const t = text.trim();
  if (!t) return "";

  const discIdx = t.search(PERTINENCIA_DISCIPLINAR_INLINE_RE);
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
  const m = t.match(PERTINENCIA_DISCIPLINAR_INLINE_RE);
  if (!m || m.index == null) return "";
  return t.slice(m.index + m[0].length).trim();
}

function extractFromSheet(sheet: ExcelSheet, element: ElementLike): string {
  const map = buildCellMap(sheet.cells);
  const labelCells = sheet.cells
    .filter((c) => c.col <= VALUE_MIN_COL && looksLikeFormLabel(c.value))
    .sort((a, b) => a.row - b.row);

  for (const labelCell of labelCells) {
    const labelNorm = normalizeForMatch(labelCell.value);
    const rowValue = collectRowValue(map, labelCell.row, labelCell.col + 1);
    if (!rowValue || rowValue.length < 20) continue;

    if (isContinuityElement(element) && CONTINUITY_LABEL_RE.test(labelNorm)) {
      return toAnswerOnly(rowValue, labelCell.value);
    }

    if (
      (isPertinenciaLocalElement(element) || isPertinenciaDisciplinarElement(element)) &&
      PERTINENCIA_COMBINED_LABEL_RE.test(labelNorm)
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
    return extractGenericFormRow(element, labelCells, map);
  }

  return "";
}

export function extractFormRowFromExcel(
  structuredFiles: ExcelStructuredData[],
  element: ElementLike
): { content: string; confidence: number } | null {
  if (!isFormRowElement(element)) return null;

  for (const file of structuredFiles) {
    for (const sheet of sortSheetsByPriority(file.sheets)) {
      const content = extractFromSheet(sheet, element);
      if (content.length > 20) {
        return { content, confidence: 0.94 };
      }
    }
  }
  return null;
}
