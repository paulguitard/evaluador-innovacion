import { fuzzyMatchScore, normalizeForMatch } from "@/lib/text-match";

export type RubricDimension = {
  name: string;
  content: string;
};

export type RubricSubdimension = {
  name: string;
  content: string;
};

const CANONICAL_DIMENSIONS: Array<{ label: string; header: RegExp }> = [
  {
    label: "Novedad",
    header:
      /(?:^|\n)\s*(?:[-=*#]+\s*)*(?:Dimensi[oó]n\s+)?Novedad\s*[:-]/im,
  },
  {
    label: "Potencial de impacto",
    header:
      /(?:^|\n)\s*(?:[-=*#]+\s*)*(?:Dimensi[oó]n\s+)?(?:Potencial\s+de\s+[Ii]mpacto|Impacto)\s*[:-]/im,
  },
  {
    label: "Escalabilidad",
    header:
      /(?:^|\n)\s*(?:[-=*#]+\s*)*(?:Dimensi[oó]n\s+)?Escalabilidad\s*[:-]/im,
  },
  {
    label: "Resultado final",
    header:
      /(?:^|\n)\s*(?:[-=*#]+\s*)*(?:Dimensi[oó]n\s+)?Resultado\s+[Ff]inal\s*[:-]/im,
  },
];

type DimensionHeader = { label: string; index: number; headerEnd: number };

function findDimensionHeaders(text: string): DimensionHeader[] {
  const headers: DimensionHeader[] = [];
  const seen = new Set<string>();

  for (const dim of CANONICAL_DIMENSIONS) {
    const match = dim.header.exec(text);
    if (!match) continue;
    if (seen.has(dim.label)) continue;
    seen.add(dim.label);
    headers.push({
      label: dim.label,
      index: match.index,
      headerEnd: match.index + match[0].length,
    });
  }

  return headers.sort((a, b) => a.index - b.index);
}

/**
 * Extrae dimensiones de evaluación desde el texto de la rúbrica.
 * Soporta encabezados IGIP (Dimensión Novedad:, ## Novedad, etc.).
 */
export function parseRubricDimensions(
  rubricText: string,
  extraDimensionLabels: string[] = []
): RubricDimension[] {
  const text = rubricText.trim();
  if (!text) return [];

  const headers = findDimensionHeaders(text);
  if (headers.length > 0) {
    const dimensions: RubricDimension[] = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].headerEnd;
      const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      if (content.length > 20) {
        dimensions.push({ name: headers[i].label, content });
      }
    }
    if (dimensions.length > 0) return dimensions;
  }

  // Fallback legado: nombres sueltos al inicio de línea con : o -
  const dimensions: RubricDimension[] = [];
  const found = new Set<string>();
  const legacyNames = [
    "Novedad",
    "Potencial de impacto",
    "Potencial de Impacto",
    "Impacto",
    "Escalabilidad",
    "Resultado final",
    "Resultado Final",
    ...extraDimensionLabels.filter((l) => l.trim()),
  ];

  for (const name of legacyNames) {
    const regex = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?${escapeRegex(name)}(?:\\*\\*)?\\s*[:\\-]`,
      "i"
    );
    const match = regex.exec(text);
    if (!match) continue;
    const normName = normalizeDimensionName(name);
    if (found.has(normName)) continue;

    const start = match.index + match[0].length;
    let end = text.length;
    for (const other of legacyNames) {
      if (other.toLowerCase() === name.toLowerCase()) continue;
      const nextRegex = new RegExp(
        `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?${escapeRegex(other)}(?:\\*\\*)?\\s*[:\\-]`,
        "i"
      );
      const nextMatch = nextRegex.exec(text.slice(start));
      if (nextMatch && nextMatch.index >= 0) {
        end = Math.min(end, start + nextMatch.index);
      }
    }
    const content = text.slice(start, end).trim();
    if (content.length > 20) {
      dimensions.push({ name: normName, content });
      found.add(normName);
    }
  }

  if (dimensions.length > 0) return dimensions;

  // Fallback: bloques separados por doble salto y título en primera línea
  const blocks = text.split(/\n\s*\n+/).filter((b) => b.trim().length > 40);
  for (const block of blocks.slice(0, 6)) {
    const lines = block.trim().split("\n");
    const title = lines[0]?.replace(/^#+\s*|\*\*/g, "").trim().slice(0, 80);
    const body = lines.slice(1).join("\n").trim() || block;
    if (title && body.length > 30) {
      dimensions.push({ name: title, content: body });
    }
  }

  if (dimensions.length === 0) {
    return [{ name: "Evaluación general", content: text }];
  }
  return dimensions;
}

function normalizeDimensionName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("novedad")) return "Novedad";
  if (lower.includes("impacto")) return "Potencial de impacto";
  if (lower.includes("escalabilidad")) return "Escalabilidad";
  if (lower.includes("resultado")) return "Resultado final";
  return name.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extrae subdimensiones desde el bloque de una dimensión.
 * Soporta: Subdimensión "Nombre" / Subdimensión Nombre
 */
export function parseRubricSubdimensions(dimensionContent: string): RubricSubdimension[] {
  const text = dimensionContent.trim();
  if (!text) return [];

  const regex =
    /\bSubdimensi[oó]n\s+(?:"([^"]+)"|'([^']+)'|([A-ZÁÉÍÓÚÑ][^\n]*?))\s*(?=\n|$)/gi;
  const matches: { index: number; length: number; name: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const name = (m[1] || m[2] || m[3] || "").trim();
    if (name) matches.push({ index: m.index, length: m[0].length, name });
  }

  const subdims: RubricSubdimension[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    if (content.length > 20) {
      subdims.push({ name: matches[i].name, content });
    }
  }
  return subdims;
}

function relevanceTermsForFocus(
  focusName: string,
  dimensionName: string,
  rubricContent: string
): string[] {
  const terms = new Set<string>();
  const addFrom = (text: string) => {
    for (const w of normalizeForMatch(text).split(" ")) {
      if (w.length >= 4) terms.add(w);
    }
  };
  addFrom(focusName);
  addFrom(dimensionName);
  addFrom(rubricContent.slice(0, 500));
  return [...terms];
}

function scoreProjectRowRelevance(
  row: { element: string; content: string },
  focusName: string,
  dimensionName: string,
  terms: string[]
): number {
  const blob = normalizeForMatch(`${row.element} ${row.content}`);
  let score = fuzzyMatchScore(row.element, focusName) * 40;
  score += fuzzyMatchScore(row.element, dimensionName) * 15;
  score += fuzzyMatchScore(blob, focusName) * 25;
  for (const t of terms) {
    if (blob.includes(t)) score += t.length >= 7 ? 4 : 2;
  }
  return score;
}

function formatProjectRows(
  rows: { element: string; content: string }[],
  maxChars: number
): string {
  const text = rows.map((r) => `${r.element}: ${r.content}`).join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

/**
 * Fragmento del proyecto extraído relevante al foco de evaluación (dimensión o subdimensión).
 * Prioriza elementos cuyo título/contenido coincide con el criterio evaluado.
 */
export function summarizeProjectForEvaluationFocus(
  table: { element: string; content: string }[],
  focus: { name: string; dimensionName: string; rubricContent: string },
  maxChars = 1200,
  topN = 8
): string {
  if (table.length === 0) return "";

  const terms = relevanceTermsForFocus(focus.name, focus.dimensionName, focus.rubricContent);
  const scored = table
    .map((row) => ({
      row,
      score: scoreProjectRowRelevance(row, focus.name, focus.dimensionName, terms),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return summarizeProjectForRag(table, maxChars);
  }

  const limit = Math.max(1, Math.min(50, topN));
  const top = scored.slice(0, Math.min(limit, scored.length)).map((x) => x.row);
  return formatProjectRows(top, maxChars);
}

/** Resumen corto del proyecto para queries RAG en evaluación (fallback genérico). */
export function summarizeProjectForRag(
  table: { element: string; content: string }[],
  maxChars = 2000
): string {
  const text = table.map((r) => `${r.element}: ${r.content}`).join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}
