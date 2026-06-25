/**
 * Política de fuentes de extracción: evita que fallbacks (keyword/RAG/heurística)
 * sobrescriban resultados ya obtenidos por extractores estructurados confiables.
 */

export type ExtractionMethod =
  | "form_row"
  | "objectives_section"
  | "project_prominent"
  | "heuristic"
  | "rag_llm"
  | "keyword_scan"
  | "agent"
  | string;

/** Métodos que leen estructura Excel/plantilla y no deben ser reemplazados por texto libre. */
const CANONICAL_PREFIXES = ["form_row", "objectives_section", "project_prominent:"] as const;

export function isCanonicalExtraction(method: ExtractionMethod): boolean {
  const m = method.trim();
  if (!m) return false;
  return CANONICAL_PREFIXES.some((prefix) => m === prefix || m.startsWith(prefix));
}

/** ¿Permitir keyword_scan / RAG / heurística como reemplazo del contenido actual? */
export function allowFallbackOverwrite(method: ExtractionMethod, hasContent: boolean): boolean {
  if (!hasContent) return true;
  return !isCanonicalExtraction(method);
}
