export type SubdimensionFieldLimits = {
  analysis: number;
  justification: number;
  improvements: number;
};

export type ParsedSubdimensionLimit = {
  name: string;
  limits: SubdimensionFieldLimits;
};

export type ParsedDimensionLimit = {
  name: string;
  overview: number;
  subdimensions: ParsedSubdimensionLimit[];
};

export type ReportFormatLimits = {
  summary: number;
  dimensions: ParsedDimensionLimit[];
  synthesis: number;
};

const DEFAULT_SUMMARY = 1000;
const DEFAULT_OVERVIEW = 500;
const DEFAULT_FIELD = 500;
const DEFAULT_SYNTHESIS = 1000;

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFieldLimits(text: string): SubdimensionFieldLimits {
  const analysis = text.match(/(\d+)\s*caracteres?\s*para\s+anal[ií]sis/i)?.[1];
  const justification = text.match(/(\d+)\s*caracteres?\s*para\s+justificaci[oó]n/i)?.[1];
  const improvements = text.match(/(\d+)\s*caracteres?\s*para\s+posibles\s+mejoras/i)?.[1];

  if (analysis || justification || improvements) {
    return {
      analysis: analysis ? Number(analysis) : DEFAULT_FIELD,
      justification: justification ? Number(justification) : DEFAULT_FIELD,
      improvements: improvements ? Number(improvements) : DEFAULT_FIELD,
    };
  }

  const single = text.match(/(\d+)\s*caracteres?/i)?.[1];
  const n = single ? Number(single) : DEFAULT_FIELD;
  return { analysis: n, justification: n, improvements: n };
}

function parseDimensionName(line: string): string | null {
  const m = line.match(/Dimensi[oó]n\s*"?([^"(]+?)"?\s*\(/i);
  return m?.[1]?.trim() ?? null;
}

function parseSubdimensionName(line: string): string | null {
  const m = line.match(/Subdimensi[oó]n\s+(.+?)\s*\(/i);
  return m?.[1]?.replace(/["']/g, "").trim() ?? null;
}

function lastParenGroup(line: string): string | null {
  const idx = line.lastIndexOf("(");
  if (idx < 0) return null;
  const end = line.lastIndexOf(")");
  if (end <= idx) return null;
  return line.slice(idx + 1, end);
}

/**
 * Extrae límites de caracteres desde el texto libre de "Formato de informe".
 */
export function parseReportFormatLimits(reportFormat: string): ReportFormatLimits {
  const limits: ReportFormatLimits = {
    summary: DEFAULT_SUMMARY,
    dimensions: [],
    synthesis: DEFAULT_SYNTHESIS,
  };

  const dimByNorm = new Map<string, ParsedDimensionLimit>();

  for (const rawLine of reportFormat.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^1\.\s*Resumen/i.test(line)) {
      const n = lastParenGroup(line)?.match(/(\d+)\s*caracteres?/i)?.[1];
      if (n) limits.summary = Number(n);
      continue;
    }

    if (/^5\.\s*S[ií]ntesis/i.test(line)) {
      const n = lastParenGroup(line)?.match(/(\d+)\s*caracteres?/i)?.[1];
      if (n) limits.synthesis = Number(n);
      continue;
    }

    if (/^\d+\.\s*Dimensi[oó]n/i.test(line)) {
      const name = parseDimensionName(line);
      const paren = lastParenGroup(line);
      const overview = paren?.match(/(\d+)\s*caracteres?/i)?.[1];
      if (!name) continue;
      const dim: ParsedDimensionLimit = {
        name,
        overview: overview ? Number(overview) : DEFAULT_OVERVIEW,
        subdimensions: [],
      };
      dimByNorm.set(normalizeName(name), dim);
      limits.dimensions.push(dim);
      continue;
    }

    if (/^\d+\.\d+\s*Subdimensi[oó]n/i.test(line)) {
      const name = parseSubdimensionName(line);
      const paren = lastParenGroup(line);
      if (!name || !paren) continue;

      const sub: ParsedSubdimensionLimit = {
        name,
        limits: parseFieldLimits(paren),
      };

      const parentDim = limits.dimensions[limits.dimensions.length - 1];
      if (parentDim) {
        parentDim.subdimensions.push(sub);
      }
    }
  }

  return limits;
}

export function findDimensionLimits(
  limits: ReportFormatLimits,
  dimensionName: string
): ParsedDimensionLimit | undefined {
  const norm = normalizeName(dimensionName);
  return limits.dimensions.find((d) => normalizeName(d.name) === norm);
}

export function findSubdimensionLimits(
  limits: ReportFormatLimits,
  dimensionName: string,
  subdimensionName: string
): SubdimensionFieldLimits | undefined {
  const dim = findDimensionLimits(limits, dimensionName);
  if (!dim) return undefined;
  const subNorm = normalizeName(subdimensionName);
  const sub = dim.subdimensions.find((s) => normalizeName(s.name) === subNorm);
  if (sub) return sub.limits;

  // Coincidencia parcial (p. ej. "Grado de Originalidad" vs "Grado de originalidad de la idea")
  const partial = dim.subdimensions.find(
    (s) =>
      subNorm.includes(normalizeName(s.name)) || normalizeName(s.name).includes(subNorm)
  );
  return partial?.limits;
}

export function charRange(max: number, minRatio = 0.9): { min: number; max: number } {
  return { min: Math.max(1, Math.floor(max * minRatio)), max };
}

export function formatLimitsTable(limits: ReportFormatLimits): string {
  const lines: string[] = [
    `- Resumen del proyecto: ${limits.summary} caracteres`,
    `- Síntesis final: ${limits.synthesis} caracteres`,
  ];
  for (const dim of limits.dimensions) {
    lines.push(`- Dimensión "${dim.name}" (análisis breve): ${dim.overview} caracteres`);
    for (const sub of dim.subdimensions) {
      lines.push(
        `  - Subdimensión "${sub.name}": análisis ${sub.limits.analysis}, justificación ${sub.limits.justification}, mejoras ${sub.limits.improvements} caracteres`
      );
    }
  }
  return lines.join("\n");
}

/** Elimina anotaciones de límite de caracteres que el LLM suele filtrar al informe. */
export function stripCharacterLimitAnnotations(text: string): string {
  return text
    .replace(/\s*\([^)]*\d+\s*caracteres?[^)]*\)/gi, "")
    .replace(/\s*~?\d+\s*caracteres\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
