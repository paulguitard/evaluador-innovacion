import {
  parseRubricDimensions,
  parseRubricSubdimensions,
} from "@/lib/rubric-dimensions";

export type RubricScoreSchemaEntry = {
  dimension: string;
  name: string;
  weight: number | null;
  key: string;
};

/** JSON autoritativo de notas emitido al cerrar la evaluación (paso 4). */
export type EvaluationScoresPayload = {
  indicatorLabel: string;
  subdimensionScores: Record<string, number | null>;
  rows: {
    key: string;
    dimension: string;
    subdimension: string;
    score: number | null;
    weight: number | null;
  }[];
  overallScore: number | null;
};

export function buildEvaluationScoresPayload(
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  indicatorLabel = "IGIP"
): EvaluationScoresPayload {
  return {
    indicatorLabel,
    subdimensionScores: { ...scores },
    rows: schema.map((entry) => ({
      key: entry.key,
      dimension: entry.dimension,
      subdimension: entry.name,
      score: scores[entry.key] ?? null,
      weight: entry.weight,
    })),
    overallScore: computeWeightedIndicatorScore(schema, scores),
  };
}

export function subdimensionScoreKey(dimension: string, name: string): string {
  return `${dimension} / ${name}`;
}

/** Extrae ponderación desde contenido de subdimensión, ej. "Ponderación (25%)". */
export function parseSubdimensionWeight(subContent: string): number | null {
  const m = /Ponderaci[oó]n\s*\((\d+(?:[.,]\d+)?)\s*%\)/i.exec(subContent);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compara nombres de subdimensión tolerando abreviaturas y puntuación. */
export function subdimensionNamesMatch(expected: string, found: string): boolean {
  const a = normalizeNameForMatch(expected);
  const b = normalizeNameForMatch(found);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const tokensA = a.split(" ").filter((t) => t.length > 3);
  if (tokensA.length === 0) return false;
  const hits = tokensA.filter((t) => b.includes(t)).length;
  return hits >= Math.max(2, Math.ceil(tokensA.length * 0.55));
}

function parseScoreFromMatches(matches: RegExpMatchArray[]): number | null {
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = parseInt(matches[i][1], 10);
    if (n >= 1 && n <= 4) return n;
  }
  return null;
}

/** Extrae nota 1–4 desde texto de evaluación de subdimensión. */
export function parseSubdimensionScore(llmText: string): number | null {
  const text = llmText.trim();
  if (!text) return null;

  const notaLineMatches = [
    ...text.matchAll(
      /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?Nota(?:\*\*)?\s*(?:asignada|obtenida|final)?\s*[:\-–—]?\s*([1-4])\b/gi
    ),
  ];
  const fromNotaLine = parseScoreFromMatches(notaLineMatches);
  if (fromNotaLine != null) return fromNotaLine;

  // Formato markdown compacto que emite el modelo: "**Nota:** N" o "**Nota: N**" (asteriscos rodeando los dos puntos)
  // aparece con frecuencia inline dentro de un párrafo, no como línea nueva. Debe extraerse igual.
  const boldNotaMatches = [
    ...text.matchAll(
      /\*\*\s*Nota\s*(?:asignada|obtenida|final)?\s*[:\-–—]\s*(?:\*\*)?\s*([1-4])(?:\s*\*\*)?\b/gi
    ),
  ];
  const fromBoldNota = parseScoreFromMatches(boldNotaMatches);
  if (fromBoldNota != null) return fromBoldNota;

  const inlineNota = /(?:^|\n)\s*Nota\s*(?:asignada|obtenida|final)?\s*[:\-–—]?\s*([1-4])\b/i.exec(
    text
  );
  if (inlineNota) return parseInt(inlineNota[1], 10);

  const califMatches = [
    ...text.matchAll(
      /(?:^|\n)\s*(?:Calificaci[oó]n|Puntuaci[oó]n|Valor)(?:\s+(?:asignada|obtenida|final))?\s*[:\-–—]?\s*([1-4])\b/gi
    ),
  ];
  const fromCalif = parseScoreFromMatches(califMatches);
  if (fromCalif != null) return fromCalif;

  const assignMatches = [
    ...text.matchAll(
      /(?:asignamos?|otorgamos?|corresponde)\s+(?:la\s+)?nota\s+([1-4])\b/gi
    ),
  ];
  const fromAssign = parseScoreFromMatches(assignMatches);
  if (fromAssign != null) return fromAssign;

  const verbalNotaMatches = [
    ...text.matchAll(
      /(?:nota|calificaci[oó]n|puntuaci[oó]n)\s+(?:de|del|es|=)\s*([1-4])\b/gi
    ),
  ];
  const fromVerbal = parseScoreFromMatches(verbalNotaMatches);
  if (fromVerbal != null) return fromVerbal;

  const scaleMatches = [...text.matchAll(/(?:^|\n)\s*([1-4])\s*\/\s*4\b/gi)];
  const fromScale = parseScoreFromMatches(scaleMatches);
  if (fromScale != null) return fromScale;

  const notaBlock = /\*\*Nota\*\*[\s\S]{0,120}/i.exec(text);
  if (notaBlock) {
    const after = notaBlock[0].replace(/\*\*Nota\*\*/i, "");
    const digit = /[1-4]/.exec(after);
    if (digit) return parseInt(digit[0], 10);
  }

  for (let i = text.split("\n").length - 1; i >= 0; i--) {
    const t = text.split("\n")[i].trim();
    if (/^[1-4]$/.test(t)) return parseInt(t, 10);
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lista bloques Subdimensión detectados en un informe o análisis crudo. */
export function listSubdimensionSections(text: string): { name: string; body: string }[] {
  const sections: { name: string; body: string }[] = [];
  const headerRe =
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\d+\.\d+\s+)?Subdimensi[oó]n[:\s]+["']?(.+?)["']?\s*(?:\([^)]*\))?\s*\n/gi;
  const matches = [...text.matchAll(headerRe)];
  for (let i = 0; i < matches.length; i++) {
    const rawName = (matches[i][1] ?? "").trim().replace(/\s*\([^)]*\)\s*$/, "");
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end =
      i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    if (rawName && body) sections.push({ name: rawName, body });
  }
  return sections;
}

/** Extrae el bloque de texto de una subdimensión dentro de un informe o análisis crudo. */
export function extractSubdimensionSection(text: string, subdimensionName: string): string | null {
  for (const sec of listSubdimensionSections(text)) {
    if (subdimensionNamesMatch(subdimensionName, sec.name)) return sec.body;
  }

  const name = escapeRegex(subdimensionName.trim());
  const patterns = [
    new RegExp(
      `(?:#{1,3}\\s*)?Subdimensi[oó]n[:\\s]*["']?${name}["']?[^\\n]*\\n([\\s\\S]*?)(?=(?:#{1,3}\\s*)?Subdimensi[oó]n|#{1,2}\\s*Dimensi[oó]n|$)`,
      "i"
    ),
    new RegExp(
      `\\d+\\.\\d+\\s+Subdimensi[oó]n\\s+["']?${name}["']?[\\s\\S]*?(?=\\d+\\.\\d+\\s+Subdimensi[oó]n|#{1,2}\\s*\\d|$)`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]?.trim()) return m[1].trim();
    if (m?.[0]?.trim()) return m[0].trim();
  }
  return null;
}

export function parseSubdimensionScoreFromNamedSection(
  text: string,
  _dimension: string,
  subdimensionName: string
): number | null {
  const section = extractSubdimensionSection(text, subdimensionName);
  if (!section) return null;
  return parseSubdimensionScore(section);
}

/** Completa notas faltantes buscando en análisis crudo e informe formateado. */
export function backfillSubdimensionScores(
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  sources: string[]
): Record<string, number | null> {
  const out = { ...scores };
  for (const entry of schema) {
    if (out[entry.key] != null) continue;
    for (const src of sources) {
      if (!src?.trim()) continue;

      for (const sec of listSubdimensionSections(src)) {
        if (!subdimensionNamesMatch(entry.name, sec.name)) continue;
        const parsed = parseSubdimensionScore(sec.body);
        if (parsed != null) {
          out[entry.key] = parsed;
          break;
        }
      }
      if (out[entry.key] != null) break;

      const parsed = parseSubdimensionScoreFromNamedSection(
        src,
        entry.dimension,
        entry.name
      );
      if (parsed != null) {
        out[entry.key] = parsed;
        break;
      }
    }
  }
  return out;
}

export function buildRubricScoreSchema(rubricText: string): RubricScoreSchemaEntry[] {
  const dimensions = parseRubricDimensions(rubricText);
  const entries: RubricScoreSchemaEntry[] = [];

  for (const dim of dimensions) {
    for (const sub of parseRubricSubdimensions(dim.content)) {
      entries.push({
        dimension: dim.name,
        name: sub.name,
        weight: parseSubdimensionWeight(sub.content),
        key: subdimensionScoreKey(dim.name, sub.name),
      });
    }
  }
  return entries;
}

/**
 * Calcula nota ponderada del indicador.
 * Requiere todas las notas de subdimensión; si falta alguna, devuelve null.
 * Sin ponderación explícita usa peso uniforme (1) por subdimensión.
 */
export function computeWeightedIndicatorScore(
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>
): number | null {
  if (schema.length === 0) return null;

  const entries: { score: number; weight: number }[] = [];
  for (const entry of schema) {
    const score = scores[entry.key];
    if (score == null || score < 1 || score > 4) return null;
    entries.push({ score, weight: entry.weight ?? 1 });
  }

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight === 0) return null;

  const weighted = entries.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight;
  return Math.round(weighted * 100) / 100;
}

/** Formato del indicador con exactamente 2 decimales (p. ej. 2.60). */
export function formatIndicatorScore(score: number): string {
  const rounded = Math.round(score * 100) / 100;
  return rounded.toFixed(2);
}

/** Bloque determinista de notas e índice del indicador para el informe/PDF (tabla Markdown). */
export function buildAuthoritativeScoresSection(
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  overallScore: number | null,
  indicatorLabel = "IGIP"
): string {
  const lines = ["**Notas e índice**", "", "| Subdimensión | Nota |", "| --- | --- |"];
  for (const entry of schema) {
    const score = scores[entry.key];
    if (score != null) lines.push(`| ${entry.name} | ${score} |`);
  }
  if (overallScore != null) {
    lines.push("", `**Índice ${indicatorLabel}**: ${formatIndicatorScore(overallScore)}`);
  }
  return lines.join("\n");
}

/** Mismo bloque autoritativo a partir del JSON de evaluación. */
export function buildAuthoritativeScoresSectionFromPayload(
  payload: EvaluationScoresPayload
): string {
  const schema: RubricScoreSchemaEntry[] = payload.rows.map((row) => ({
    key: row.key,
    dimension: row.dimension,
    name: row.subdimension,
    weight: row.weight,
  }));
  return buildAuthoritativeScoresSection(
    schema,
    payload.subdimensionScores,
    payload.overallScore,
    payload.indicatorLabel
  );
}

function escapeRegexLabel(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Localiza todas las apariciones de encabezados de sección de notas. */
function findAllScoresSectionStarts(report: string, indicatorLabel = "IGIP"): number[] {
  const label = escapeRegexLabel(indicatorLabel);
  const patterns = [
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\d+(?:\.\d+)?\.?\s+)?(?:\*\*)?Notas e [íi]ndice(?:\*\*)?[^\n]*/gi,
    new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\d+(?:\\.\\d+)?\\.?\\s+)?(?:\\*\\*)?Notas por subdimensi[oó]n(?:\\s+e\\s+[íi]ndice(?:\\s+${label})?)?(?:\\*\\*)?[^\\n]*`,
      "gi"
    ),
  ];
  const indices: number[] = [];
  for (const re of patterns) {
    for (const m of report.matchAll(re)) {
      if (m.index != null) indices.push(m.index);
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

/**
 * Solo devuelve inicio si la sección de notas está al cierre del informe (evita cortar el cuerpo).
 */
export function findTrailingScoresSectionStart(
  report: string,
  indicatorLabel = "IGIP"
): number | null {
  const starts = findAllScoresSectionStarts(report, indicatorLabel);
  if (starts.length === 0) return null;
  const last = starts[starts.length - 1]!;
  if (hasSubstantiveContentAfterScoresHeader(report, last)) return null;
  const tail = report.slice(last);
  const headRatio = last / Math.max(report.length, 1);
  if (headRatio >= 0.5) return last;
  if (looksLikeScoresOnlyBlock(tail)) return last;
  return null;
}

function hasSubstantiveContentAfterScoresHeader(report: string, scoresStart: number): boolean {
  const after = report.slice(scoresStart).replace(/^[^\n]*\n?/, "");
  return /(?:^|\n)\s*#{1,3}\s+(?!Notas)/im.test(after);
}

function looksLikeScoresOnlyBlock(tail: string): boolean {
  if (/(?:\*\*Análisis\*\*|## Dimensi[oó]n)/i.test(tail)) return false;
  return (
    /(?:Índice|ponderaci[oó]n|índice final)/i.test(tail) ||
    /:\s*[1-4]\s*(?:\(ponderaci)/i.test(tail)
  );
}

/** @deprecated Use findTrailingScoresSectionStart */
export function findScoresSectionStart(report: string, indicatorLabel = "IGIP"): number | null {
  return findTrailingScoresSectionStart(report, indicatorLabel);
}

const FORMATTED_FIELD_HEADERS =
  /^(?:Análisis|Justificación|Sugerencias(?:\s+de\s+mejora)?|Posibles\s+mejoras|Nota)\s*$/i;

function isLikelyNextReportSectionHeader(line: string, currentSubName: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,3}\s/.test(trimmed)) return true;
  const bold = /^\*\*([^*]+)\*\*\s*$/.exec(trimmed);
  if (!bold) return false;
  const title = bold[1].trim();
  if (FORMATTED_FIELD_HEADERS.test(title)) return false;
  if (/^Dimensi[oó]n:/i.test(title)) return true;
  if (/^(?:Resumen|Síntesis)/i.test(title)) return true;
  if (subdimensionNamesMatch(currentSubName, title)) return false;
  return true;
}

function findFormattedSubdimensionStart(formatted: string, name: string): number | null {
  const escaped = escapeRegex(name.trim());
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)${escaped}\\s*\\n`, "i"),
    new RegExp(`(?:^|\\n)\\s*\\*\\*${escaped}\\*\\*\\s*\\n`, "i"),
    new RegExp(`(?:^|\\n)\\s*\\d+\\.\\s*${escaped}\\s*\\n`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(formatted);
    if (m?.index != null) return m.index + m[0].length;
  }
  return null;
}

function extractFormattedSubdimensionBlock(formatted: string, name: string): string | null {
  for (const sec of listSubdimensionSections(formatted)) {
    if (subdimensionNamesMatch(name, sec.name)) return sec.body;
  }
  const startIdx = findFormattedSubdimensionStart(formatted, name);
  if (startIdx == null) return null;
  const bodyLines: string[] = [];
  for (const line of formatted.slice(startIdx).split("\n")) {
    if (isLikelyNextReportSectionHeader(line, name)) break;
    bodyLines.push(line);
  }
  const body = bodyLines.join("\n").trim();
  return body || null;
}

function isSubdimensionCompleteInFormatted(formatted: string, name: string): boolean {
  const body = extractFormattedSubdimensionBlock(formatted, name);
  if (!body) return false;
  return parseSubdimensionScore(body) != null;
}

function removeFormattedSubdimensionBlock(formatted: string, name: string): string {
  for (const sec of listSubdimensionSections(formatted)) {
    if (!subdimensionNamesMatch(name, sec.name)) continue;
    const headerRe = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\d+\\.\\d+\\s+)?Subdimensi[oó]n[:\\s]+["']?${escapeRegex(sec.name)}["']?[^\\n]*\\n[\\s\\S]*?(?=\\n\\s*(?:#{1,3}\\s*)?(?:\\d+\\.\\d+\\s+)?Subdimensi[oó]n|#{1,2}\\s*Dimensi|$)`,
      "i"
    );
    const next = formatted.replace(headerRe, "\n").trimEnd();
    if (next !== formatted) return next;
  }
  const start = findFormattedSubdimensionStart(formatted, name);
  if (start == null) return formatted;
  let end = formatted.length;
  const afterLines = formatted.slice(start).split("\n");
  let offset = start;
  for (const line of afterLines) {
    if (offset > start && isLikelyNextReportSectionHeader(line, name)) {
      end = offset;
      break;
    }
    offset += line.length + 1;
  }
  const headerStart = formatted
    .slice(0, start)
    .search(new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*|\\*\\*)${escapeRegex(name.trim())}`, "i"));
  const cutFrom = headerStart >= 0 ? headerStart : start;
  return `${formatted.slice(0, cutFrom).trimEnd()}\n${formatted.slice(end).trimStart()}`.trimEnd();
}

function dimensionHeadingPresent(formatted: string, dimensionName: string): boolean {
  const escaped = escapeRegex(dimensionName.trim());
  return new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?Dimensi[oó]n[:\\s]+${escaped}|\\*\\*Dimensi[oó]n:\\s*${escaped}\\*\\*`,
    "i"
  ).test(formatted);
}

/** Cuenta subdimensiones con Nota detectada en el informe formateado. */
export function countCompleteSubdimensionsInFormatted(
  formatted: string,
  dimensions: { subdimensions: { name: string }[] }[]
): { complete: number; total: number } {
  let total = 0;
  let complete = 0;
  for (const dim of dimensions) {
    for (const sub of dim.subdimensions) {
      total++;
      if (isSubdimensionCompleteInFormatted(formatted, sub.name)) complete++;
    }
  }
  return { complete, total };
}

/**
 * Solo repara si la cobertura es baja (truncado grave). Evita duplicar bloques al final
 * cuando el formateo monolítico ya incluye la mayoría de subdimensiones.
 */
export function shouldRepairFormattedReport(
  formatted: string,
  dimensions: { subdimensions: { name: string }[] }[],
  options?: { minCoverageRatio?: number; minComplete?: number }
): boolean {
  const { complete, total } = countCompleteSubdimensionsInFormatted(formatted, dimensions);
  if (total === 0) return false;
  if (complete === 0) return true;
  const ratio = complete / total;
  const minRatio = options?.minCoverageRatio ?? 0.8;
  if (ratio >= minRatio) return false;
  const minComplete = options?.minComplete ?? Math.max(1, Math.ceil(total * minRatio));
  return complete < minComplete;
}

/**
 * Si el formateo LLM truncó o omitió subdimensiones, las recupera desde el análisis crudo.
 */
export function repairFormattedReportFromRaw(
  formatted: string,
  rawEvaluation: string,
  dimensions: { name: string; subdimensions: { name: string }[] }[]
): string {
  let result = formatted.trimEnd();
  const appendBlocks: string[] = [];

  for (const dim of dimensions) {
    const missingSubs: { name: string; body: string }[] = [];
    for (const sub of dim.subdimensions) {
      if (isSubdimensionCompleteInFormatted(result, sub.name)) continue;
      const body = extractSubdimensionSection(rawEvaluation, sub.name);
      if (!body?.trim()) continue;
      if (extractFormattedSubdimensionBlock(result, sub.name)) {
        result = removeFormattedSubdimensionBlock(result, sub.name);
      }
      missingSubs.push({ name: sub.name, body: body.trim() });
    }
    if (missingSubs.length === 0) continue;

    const dimHeading = dimensionHeadingPresent(result, dim.name);
    if (!dimHeading && !dimensionHeadingPresent(appendBlocks.join("\n"), dim.name)) {
      appendBlocks.push(`## Dimensión: ${dim.name}`);
    }
    for (const { name, body } of missingSubs) {
      appendBlocks.push(`## ${name}\n\n${body}`);
    }
  }

  if (appendBlocks.length === 0) return result;
  return `${result}\n\n${appendBlocks.join("\n\n")}`;
}

/**
 * Inserta el bloque autoritativo al cierre. Solo elimina una sección de notas LLM si está al final.
 */
export function injectAuthoritativeScoresSection(
  report: string,
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  overallScore: number | null,
  indicatorLabel = "IGIP"
): string {
  const section = buildAuthoritativeScoresSection(schema, scores, overallScore, indicatorLabel);
  const trailingStart = findTrailingScoresSectionStart(report, indicatorLabel);
  const base =
    trailingStart != null ? report.slice(0, trailingStart).trimEnd() : report.trimEnd();
  return `${base}\n\n${section}`;
}

const PROJECT_SUMMARY_PATTERNS = [
  /resumen del proyecto/i,
  /^\s*\*{0,2}\s*\d+\.\s*resumen/i,
  /\b(el|la)\s+proyecto\s+[\wáéíóúñ]+/i,
  /tiene como objetivo/i,
  /objetivo (principal|general)/i,
  /es una (evoluci[oó]n|iniciativa|propuesta|plataforma)/i,
];

/** Detecta si un texto describe el proyecto en lugar de la evaluación. */
export function isProjectDescriptionSummary(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return PROJECT_SUMMARY_PATTERNS.some((p) => p.test(t));
}

/** Síntesis evaluativa determinista a partir de notas (fallback). */
export function buildDeterministicEvaluationSummary(
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  overallScore: number | null,
  indicatorLabel = "IGIP",
  summaryMaxChars = 300
): string {
  const parts: string[] = [];
  if (overallScore != null) {
    const note =
      overallScore % 1 === 0 ? String(overallScore) : overallScore.toFixed(1);
    parts.push(`Evaluación ${indicatorLabel}: nota ${note}.`);
  }

  const lows: string[] = [];
  const highs: string[] = [];
  for (const entry of schema) {
    const s = scores[entry.key];
    if (s == null) continue;
    const short = abbreviateSubdimensionName(entry.name, 36);
    if (s <= 2) lows.push(`${short} (${s})`);
    else if (s >= 3) highs.push(`${short} (${s})`);
  }
  if (highs.length) parts.push(`Fortalezas en ${highs.slice(0, 2).join("; ")}.`);
  if (lows.length) parts.push(`Debilidades en ${lows.slice(0, 2).join("; ")}.`);

  if (parts.length === 0) {
    return `Evaluación ${indicatorLabel} completada; consulte el informe para el detalle por subdimensión.`;
  }
  return truncateSummary(parts.join(" "), summaryMaxChars);
}

/** Síntesis determinista para rúbrica por niveles (fallback). */
export function buildDeterministicLevelsEvaluationSummary(
  assignedLevel: number | null,
  levelTitle: string,
  indicatorLabel: string,
  rawEvaluation: string,
  summaryMaxChars = 1000
): string {
  const parts: string[] = [];
  if (assignedLevel != null) {
    parts.push(
      `La evaluación ${indicatorLabel} sitúa el emprendimiento en el nivel ${assignedLevel}${levelTitle ? ` (${levelTitle})` : ""}.`
    );
  }

  const justIdx = rawEvaluation.search(/justificaci[oó]n/i);
  if (justIdx >= 0) {
    const excerpt = rawEvaluation
      .slice(justIdx)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, Math.max(200, summaryMaxChars - 120));
    if (excerpt.length > 60) parts.push(excerpt);
  } else {
    const compact = rawEvaluation.replace(/\s+/g, " ").trim();
    if (compact.length > 80) {
      parts.push(compact.slice(0, Math.max(180, summaryMaxChars - 100)));
    }
  }

  if (parts.length === 0) {
    return `Evaluación ${indicatorLabel} completada; consulte el informe para el detalle del nivel asignado.`;
  }
  return truncateSummary(parts.join(" "), summaryMaxChars);
}

/** Valida síntesis LLM o usa fallback determinista. */
export function finalizeEvaluationSummary(
  llmText: string,
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  overallScore: number | null,
  indicatorLabel = "IGIP",
  summaryMaxChars = 300
): string {
  const clean = llmText.trim();
  if (clean && !isProjectDescriptionSummary(clean)) {
    return truncateSummary(clean, summaryMaxChars);
  }
  return buildDeterministicEvaluationSummary(
    schema,
    scores,
    overallScore,
    indicatorLabel,
    summaryMaxChars
  );
}

/** Input acotado para síntesis: solo notas y fragmentos evaluativos. */
export function buildEvaluationInputForSummary(
  rawEvaluation: string,
  sanitizedReport: string,
  schema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>
): string {
  const lines: string[] = ["Notas por subdimensión:"];
  for (const entry of schema) {
    const s = scores[entry.key];
    if (s != null) lines.push(`- ${entry.dimension} / ${entry.name}: ${s}`);
  }

  const synthMatch = /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\d+\.\s*)?S[ií]ntesis[\s\S]*/i.exec(
    sanitizedReport
  );
  if (synthMatch?.[0]?.trim()) {
    lines.push("", "Síntesis del informe:", synthMatch[0].slice(0, 2500));
  } else {
    const evalOnly = rawEvaluation
      .split(/\n---\n/)
      .map((block) =>
        block
          .split("\n")
          .filter((line) => !/^\s*##\s*Dimensi[oó]n:/i.test(line))
          .join("\n")
      )
      .join("\n\n");
    lines.push("", "Fragmentos evaluativos:", evalOnly.slice(0, 4500));
  }
  return lines.join("\n");
}

/** Trunca texto a maxLen caracteres en límite de palabra. */
export function truncateSummary(text: string, maxLen = 300): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  const slice = clean.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.7) return `${slice.slice(0, lastSpace)}…`;
  return `${slice}…`;
}

/** Abrevia nombre de subdimensión para encabezado de tabla. */
export function abbreviateSubdimensionName(name: string, maxLen = 24): string {
  const t = name.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}
