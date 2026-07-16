import {
  EVALUATION_RESPONSE_LANGUAGE_RULE,
  EVALUATION_SYSTEM_SUFFIX,
} from "@/lib/system-prompts-catalog";

export const EVALUATE_CONTEXT_TRUNCATION_MARKERS = [
  "[Documentación de referencia truncada por límite de longitud.]",
  "[Contexto truncado por límite de longitud.]",
] as const;

export type EvaluateContextSectionId =
  | "config"
  | "focus"
  | "project"
  | "knowledge"
  | "rubric";

const SECTION_DEFS: Array<{
  id: EvaluateContextSectionId;
  marker: string;
  label: string;
}> = [
  {
    id: "config",
    marker: "## Configuración actual",
    label: "Resumen de configuración y metodología",
  },
  {
    id: "focus",
    marker: "## Enfoque de esta evaluación parcial",
    label: "Enfoque del criterio activo",
  },
  {
    id: "project",
    marker: "## Documentos del proyecto",
    label: "Elementos extraídos del proyecto",
  },
  {
    id: "knowledge",
    marker: "## Documentación de referencia",
    label: "Fragmentos Knowledge (RAG)",
  },
  {
    id: "rubric",
    marker: "## Rúbrica y criterios",
    label: "Rúbrica y criterios de evaluación",
  },
];

export class EvaluateSystemContextError extends Error {
  readonly missingSections: string[];

  constructor(missingSections: string[], message: string) {
    super(message);
    this.name = "EvaluateSystemContextError";
    this.missingSections = missingSections;
  }
}

function extractSection(content: string, marker: string): string | null {
  const start = content.indexOf(marker);
  if (start < 0) return null;
  const afterHeader = content.indexOf("\n", start);
  const bodyStart = afterHeader >= 0 ? afterHeader + 1 : start + marker.length;
  const nextHeading = content.slice(bodyStart).search(/\n## /);
  const bodyEnd = nextHeading >= 0 ? bodyStart + nextHeading : content.length;
  return content.slice(bodyStart, bodyEnd).trim();
}

function sectionHasSubstance(id: EvaluateContextSectionId, body: string): boolean {
  if (!body) return false;
  switch (id) {
    case "config":
      return body.includes("**Metodología de evaluación:**");
    case "focus":
      return body.length >= 40 && !body.includes("[Criterios de la");
    case "project":
      return body.includes("**") && !body.startsWith("[En runtime");
    case "knowledge":
      return body.includes("### Documento:");
    case "rubric":
      return (
        body.length >= 30 &&
        !body.startsWith("No hay rúbrica de evaluación configurada")
      );
    default:
      return body.length > 0;
  }
}

export function validateEvaluateSystemContext(
  content: string,
  ctx?: { subdimensionLabel?: string }
): void {
  const trimmed = content.trim();
  const label = ctx?.subdimensionLabel ? ` (${ctx.subdimensionLabel})` : "";

  if (!trimmed) {
    throw new EvaluateSystemContextError(
      ["contexto completo"],
      `El contexto de evaluación${label} quedó vacío. Verifique configuración, extracción, Knowledge y rúbrica.`
    );
  }

  for (const marker of EVALUATE_CONTEXT_TRUNCATION_MARKERS) {
    if (trimmed.includes(marker)) {
      throw new EvaluateSystemContextError(
        ["truncación"],
        `El contexto de evaluación${label} fue truncado (${marker}). Aumente «System max chars» en RAG de evaluación o reduzca el contenido.`
      );
    }
  }

  const missing: string[] = [];
  for (const def of SECTION_DEFS) {
    const body = extractSection(trimmed, def.marker);
    if (!body || !sectionHasSubstance(def.id, body)) {
      missing.push(def.label);
    }
  }

  if (missing.length > 0) {
    throw new EvaluateSystemContextError(
      missing,
      `Contexto de evaluación${label} incompleto. Faltan o están vacías: ${missing.join(", ")}.`
    );
  }
}

export function validateProjectElementsForEvaluation(
  projectElementsTable: { element: string; content: string }[]
): void {
  if (!projectElementsTable.length) {
    throw new EvaluateSystemContextError(
      ["elementos del proyecto"],
      "No hay elementos extraídos del proyecto. Complete la extracción antes de evaluar."
    );
  }
  const withContent = projectElementsTable.filter((r) => r.content?.trim());
  if (!withContent.length) {
    throw new EvaluateSystemContextError(
      ["contenido de elementos"],
      "Los elementos del proyecto no tienen contenido extraído. Revise la extracción antes de evaluar."
    );
  }
}

/** System message de evaluación sin fallback: exige contexto completo y validado. */
export function buildStrictEvaluationSystemMessage(systemContent: string): string {
  const base = systemContent.trim();
  if (!base) {
    throw new EvaluateSystemContextError(
      ["contexto completo"],
      "No se puede ensamblar el system message: el contexto está vacío."
    );
  }
  return `${EVALUATION_RESPONSE_LANGUAGE_RULE}\n\n${base}${EVALUATION_SYSTEM_SUFFIX}`;
}
