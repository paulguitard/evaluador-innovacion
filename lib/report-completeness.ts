import { parseSubdimensionScore } from "@/lib/evaluation-scores";
import { isSectionTextTruncated } from "@/lib/format-report-sections";
import {
  findMissingReportSectionTitles,
  type ReportFormatConfig,
} from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";

export type SubdimensionQualityIssue =
  | "missing_analisis"
  | "missing_nota"
  | "missing_justificacion"
  | "missing_mejoras"
  | "truncated";

const SECTION_STOP =
  /(?:^|\n)\s*(?:\*\*)?(?:Nota(?:\s*(?:asignada|obtenida|final))?|Calificaci[o\u00f3]n|Puntuaci[o\u00f3]n|Valor(?:\s+(?:asignada|obtenida|final))?|Justificaci[o\u00f3]n|Posibles\s+mejoras|Sugerencias(?:\s+de\s+mejora)?|Mejoras)(?:\*\*)?\b/i;

function extractNamedSectionBody(text: string, headerRe: RegExp, stopRe: RegExp): string | null {
  const header = headerRe.exec(text);
  if (!header || header.index === undefined) return null;
  const start = header.index + header[0].length;
  const rest = text.slice(start);
  const stop = stopRe.exec(rest);
  return (stop ? rest.slice(0, stop.index) : rest).trim();
}

/** Extrae el cuerpo de Analisis (hasta Nota / Justificacion / Mejoras). */
function extractAnalisisBody(text: string): string | null {
  return extractNamedSectionBody(
    text,
    /(?:^|\n)\s*(?:\*\*)?An[a\u00e1]lisis(?:\*\*)?\b[^\n]*/i,
    SECTION_STOP
  );
}

function sectionBodiesForTruncationCheck(text: string): string[] {
  const bodies: string[] = [];
  const analisis = extractAnalisisBody(text);
  if (analisis) bodies.push(analisis);

  const justificacion = extractNamedSectionBody(
    text,
    /(?:^|\n)\s*(?:\*\*)?Justificaci[o\u00f3]n(?:\*\*)?\b[^\n]*/i,
    /(?:^|\n)\s*(?:\*\*)?(?:Posibles\s+mejoras|Sugerencias(?:\s+de\s+mejora)?|Mejoras)(?:\*\*)?\b/i
  );
  if (justificacion) bodies.push(justificacion);

  const mejoras = extractNamedSectionBody(
    text,
    /(?:^|\n)\s*(?:\*\*)?(?:Posibles\s+mejoras|Sugerencias(?:\s+de\s+mejora)?|Mejoras)(?:\*\*)?\b[^\n]*/i,
    /$/ 
  );
  if (mejoras) bodies.push(mejoras);

  return bodies;
}

/** Comprueba que el análisis bruto de una subdimensión tenga las secciones obligatorias y no esté truncado. */
export function getRawSubdimensionAnalysisIssues(text: string): SubdimensionQualityIssue[] {
  const body = text.trim();
  const issues: SubdimensionQualityIssue[] = [];
  if (!body) {
    return ["missing_analisis", "missing_nota", "missing_justificacion", "missing_mejoras", "truncated"];
  }

  if (!/(?:^|\n)\s*(?:\*\*)?An[aá]lisis(?:\*\*)?\b/i.test(body)) {
    issues.push("missing_analisis");
  }
  // Alineado con parseSubdimensionScore (Nota, Calificación, Puntuación, etc.).
  if (parseSubdimensionScore(body) == null) {
    issues.push("missing_nota");
  }
  if (!/(?:^|\n)\s*(?:\*\*)?Justificaci[oó]n(?:\*\*)?\b/i.test(body)) {
    issues.push("missing_justificacion");
  }
  if (
    !/(?:^|\n)\s*(?:\*\*)?(?:Posibles\s+mejoras|Sugerencias(?:\s+de\s+mejora)?|Mejoras)(?:\*\*)?\b/i.test(
      body
    )
  ) {
    issues.push("missing_mejoras");
  }
  const bodies = sectionBodiesForTruncationCheck(body);
  if (bodies.length > 0) {
    if (bodies.some((b) => b.length > 0 && isSectionTextTruncated(b))) {
      issues.push("truncated");
    }
  } else if (isSectionTextTruncated(body)) {
    issues.push("truncated");
  }
  return issues;
}

export function isRawSubdimensionAnalysisComplete(text: string): boolean {
  return getRawSubdimensionAnalysisIssues(text).length === 0;
}

/** Títulos §6 ausentes + bloque determinista de notas/índice cuando aplica. */
export function findMissingFinalReportParts(
  formatted: string,
  config: ReportFormatConfig,
  rubric: RubricConfig,
  options?: { requireScoresSection?: boolean; indicatorLabel?: string }
): string[] {
  const missing = findMissingReportSectionTitles(formatted, config, rubric);
  const requireScores = options?.requireScoresSection ?? rubric.type === "ponderaciones";
  if (requireScores) {
    const label = options?.indicatorLabel ?? "IGIP";
    const hasScores =
      /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?Notas e [íi]ndice(?:\*\*)?\b/i.test(formatted) ||
      new RegExp(
        `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?Índice\\s+${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*:`,
        "i"
      ).test(formatted);
    if (!hasScores) missing.push("Notas e índice");
  }
  return missing;
}

export function isFinalReportComplete(
  formatted: string,
  config: ReportFormatConfig,
  rubric: RubricConfig,
  options?: { requireScoresSection?: boolean; indicatorLabel?: string }
): boolean {
  return findMissingFinalReportParts(formatted, config, rubric, options).length === 0;
}

/**
 * Heurística cliente (sin config §6): detecta informe IGIP ensamblado vs borrador crudo.
 * El borrador usa «### Subdimensión:» y no incluye Resumen/Síntesis/Notas.
 */
export function looksLikeCompleteIgipReport(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const hasResumen = /(?:^|\n)\s*(?:#{1,3}\s*)?Resumen del proyecto\b/i.test(t);
  const hasSintesis = /(?:^|\n)\s*(?:#{1,3}\s*)?S[ií]ntesis final\b/i.test(t);
  const hasNotas = /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?Notas e [íi]ndice(?:\*\*)?\b/i.test(t);
  const looksLikeRawDraft =
    /(?:^|\n)\s*#{1,3}\s*Subdimensi[oó]n\s*:/i.test(t) && !hasResumen && !hasNotas;
  if (looksLikeRawDraft) return false;
  // Informe ponderaciones completo
  if (hasResumen && hasSintesis && hasNotas) return true;
  // Niveles: puede no tener Notas e índice
  if (hasResumen && hasSintesis) return true;
  // Niveles sin síntesis custom: al menos no es borrador con Subdimensión:
  if (!looksLikeRawDraft && /(?:^|\n)\s*#{1,3}\s*Nivel asignado/i.test(t)) return true;
  return false;
}
