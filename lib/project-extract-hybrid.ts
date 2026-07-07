import type { ExcelStructuredData } from "@/lib/excel-structured-extract";
import type { ElementDef } from "@/lib/excel-heuristics";
import {
  extractElementHeuristic,
  isHighConfidenceHeuristic,
} from "@/lib/excel-heuristics";
import { isFormRowElement } from "@/lib/form-row-extract";
import { isProjectNameElement } from "@/lib/excel-sheet-priority";
import { detectProjectName } from "@/lib/project-name-detect";
import { loadProjectStructuredIndex } from "@/lib/project-structured-index";
import { isShortMetadataElement } from "@/lib/project-extract-validate";
import { isAcceptableExtractedContent } from "@/lib/extract-content-quality";
import { finalizeContentForElement } from "@/lib/extract-content-clean";
import { getGanttSheetContext } from "@/lib/gantt-extract";
import { getIndicatorsSheetContext } from "@/lib/indicators-extract";
import { isGanttActivitiesElement, isIndicatorsTableElement } from "@/lib/sheet-element-routing";
import type { ExtractConfig, ExtractMethod } from "@/lib/evaluation-type-settings";

export type ExtractElementResult = {
  content: string;
  method: string;
  confidence: string;
};

const MANDATORY_LLM_HINT_DEFAULT = `

IMPORTANTE: Este campo NO puede quedar vacío. Usa las herramientas para revisar todo el proyecto (hoja Resumen Proyecto, Gantt, Indicadores, PDF). Si no encuentras el texto exacto del título, busca por la descripción del elemento y sinónimos.`;

function extractMethodAllowed(element: ElementDef, method: ExtractMethod): boolean {
  const preferred = element.extractStrategy?.preferredMethods;
  if (!preferred?.length) return true;
  return preferred.includes(method);
}

function deterministicMethodsAllowed(element: ElementDef): boolean {
  return (
    extractMethodAllowed(element, "heuristic") ||
    extractMethodAllowed(element, "form_row")
  );
}

function llmMethodsAllowed(element: ElementDef): boolean {
  return extractMethodAllowed(element, "rag_llm") || extractMethodAllowed(element, "vision");
}

export function structuredIndexToExcelFiles(sessionId: string): ExcelStructuredData[] {
  const index = loadProjectStructuredIndex(sessionId);
  if (!index?.files.length) return [];
  return index.files
    .filter((f) => f.type === "excel" && f.sheets?.length)
    .map((f) => ({
      fileName: f.fileName,
      sheets: (f.sheets ?? []).map((s) => ({
        sheetName: s.sheetName,
        cells: s.cells,
        merges: s.merges ?? [],
      })),
    }));
}

function isSolutionAdvanceElement(element: ElementDef): boolean {
  const t = `${element.title} ${element.description}`.toLowerCase();
  return /consiste la soluci|nivel de avance|grado de avance|avance actual/.test(t);
}

function isImetQaElement(element: ElementDef): boolean {
  const t = `${element.title} ${element.description}`.toLowerCase();
  return /origen|descripci.*emprendimiento|avance actual|segmento|validaci|modelo de negocio|componente tecnol/.test(
    t
  );
}

async function runLlmExtract(
  sessionId: string,
  element: ElementDef,
  options?: { timeoutMs?: number; extraHints?: string; extractConfig?: ExtractConfig },
  extraHints = ""
): Promise<ExtractElementResult> {
  const hints = buildElementLlmHints(element, options?.extractConfig);
  const combinedHints = hints + (options?.extraHints ?? "") + extraHints;
  const { extractElementLlmFirst } = await import("@/lib/project-extract-llm");
  return extractElementLlmFirst(sessionId, element, {
    timeoutMs: options?.timeoutMs,
    extraHints: combinedHints,
  });
}

/** Si el resultado está vacío, reintenta con LLM obligatorio. */
async function ensureNonEmpty(
  sessionId: string,
  element: ElementDef,
  result: ExtractElementResult,
  options?: { timeoutMs?: number; extractConfig?: ExtractConfig }
): Promise<ExtractElementResult> {
  if (result.content.trim()) return result;

  const retryHint = options?.extractConfig?.mandatoryLlmRetryHint ?? MANDATORY_LLM_HINT_DEFAULT;
  const retry = await runLlmExtract(sessionId, element, {
    timeoutMs: (options?.timeoutMs ?? 45_000) + 20_000,
    extractConfig: options?.extractConfig,
  }, retryHint);

  if (retry.content.trim()) {
    return {
      ...retry,
      method: retry.method.includes("retry") ? retry.method : `${retry.method}:empty_retry`,
    };
  }
  return retry;
}

/**
 * Atajos deterministas desde Excel estructurado (metadata, filas de formulario).
 * Devuelve null si debe usarse el LLM.
 */
export function tryDeterministicExtract(
  structuredFiles: ExcelStructuredData[],
  element: ElementDef,
  extractConfig?: ExtractConfig
): ExtractElementResult | null {
  if (structuredFiles.length === 0) return null;

  if (isIndicatorsTableElement(element)) return null;
  if (isGanttActivitiesElement(element)) return null;

  if (isProjectNameElement(element)) {
    const detected = detectProjectName(structuredFiles, []);
    if (detected && detected.score >= 42) {
      return {
        content: detected.text,
        method: `excel:project_name:${detected.method}`,
        confidence: "high",
      };
    }
  }

  const heuristic = extractElementHeuristic(structuredFiles, element, {
    sheetPatterns: extractConfig?.sheetPatterns,
  });
  const content = heuristic.content.trim();
  if (!content || !isAcceptableExtractedContent(element, content)) return null;

  if (isHighConfidenceHeuristic(heuristic.confidence)) {
    return {
      content,
      method: `excel:${heuristic.method}`,
      confidence: "high",
    };
  }

  if (isFormRowElement(element) && content.length >= 40) {
    return {
      content,
      method: `form_row:${heuristic.method}`,
      confidence: "high",
    };
  }

  if (isShortMetadataElement(element) && heuristic.confidence >= 0.55) {
    return {
      content,
      method: `excel:${heuristic.method}`,
      confidence: heuristic.confidence >= 0.72 ? "high" : "medium",
    };
  }

  if (isSolutionAdvanceElement(element) && content.length >= 40) {
    return {
      content,
      method: `form_row:${heuristic.method}`,
      confidence: "high",
    };
  }

  if (isImetQaElement(element) && heuristic.method === "qa_column" && content.length >= 15) {
    return {
      content,
      method: `excel:${heuristic.method}`,
      confidence: "high",
    };
  }

  return null;
}

export function buildElementLlmHints(element: ElementDef, extractConfig?: ExtractConfig): string {
  const hints: string[] = [];

  if (extractConfig?.globalLlmHints?.trim()) {
    hints.push(extractConfig.globalLlmHints.trim());
  }
  if (element.extractStrategy?.llmHints?.trim()) {
    hints.push(element.extractStrategy.llmHints.trim());
  }

  if (/necesidad|problema|oportunidad/i.test(element.title)) {
    hints.push(
      'Busca la fila cuya etiqueta contiene "Necesidad, problema u oportunidad". El texto puede ocupar varias columnas fusionadas en la hoja "Resumen Proyecto".'
    );
  }

  if (isSolutionAdvanceElement(element)) {
    hints.push(
      'Busca la fila cuya etiqueta contiene "En qué consiste la solución", "nivel de avance" o "qué avances has logrado" en Resumen Proyecto o columna de preguntas.'
    );
    hints.push(
      `Reglas para nivel de avance:
- Busca la fila "En qué consiste la solución", "qué avances has logrado" o similar.
- Distingue lo PLANIFICADO de lo YA EJECUTADO.
- Si el documento dice "nace desde cero" o que aún no ha iniciado, repórtalo así.
- Transcribe o sintetiza fielmente lo que dice el documento sobre la solución y el avance actual.`
    );
  }

  if (/avance actual/i.test(element.title)) {
    hints.push(
      'En formularios IMET (columna pregunta / columna respuesta), busca la pregunta sobre avances logrados hasta ahora.'
    );
  }

  if (/nombre del proyecto/i.test(element.title)) {
    hints.push(
      'En formularios IMET, el nombre suele estar en la respuesta a "¿Cuál es el nombre de tu emprendimiento?". No uses la pregunta "Describe brevemente tu emprendimiento".'
    );
  }

  if (/origen de la idea|descripci.*emprendimiento/i.test(`${element.title} ${element.description}`)) {
    hints.push(
      "En Excel tipo IMET (pregunta en columna A, respuesta en columna B), empareja la pregunta con el elemento y extrae solo la respuesta."
    );
  }

  const t = `${element.title} ${element.section ?? ""} ${element.description}`.toLowerCase();
  if (/ejes?\s+de\s+impacto|focalizaci/.test(t)) {
    hints.push(
      'No uses la fila metadata "Focalización". Busca la pregunta narrativa "Ejes de impacto o focalizaciones" en Resumen Proyecto.'
    );
  }
  if (/sostenibilidad|objetivo de desarrollo sostenible|\bods\b/.test(t)) {
    hints.push(
      "Extrae la RESPUESTA del proyecto, no la pregunta del formulario."
    );
  }
  if (/factor innovador/.test(t)) {
    hints.push(
      'Usa la fila "Factor innovador del proyecto" / "Diferenciación y propuesta de valor" en Seguimiento o Resumen Proyecto.'
    );
    hints.push(
      "NO copies el texto de Continuidad de fases anteriores. Son campos distintos con respuestas distintas."
    );
  }
  if (/escalabilidad/.test(t)) {
    hints.push(
      "Responde si existen planes de expansión o replicación; no copies las preguntas del formulario."
    );
  }
  if (isGanttActivitiesElement(element)) {
    hints.push(
      element.description ||
        'Lista solo nombre y descripción de cada actividad desde la hoja Gantt/Cronograma.'
    );
  }
  if (/^indicador/.test(element.title.toLowerCase()) || (t.includes("indicador") && !/metodolog/.test(t))) {
    hints.push(
      'Usa la hoja "Indicadores". Estructura cada indicador en bloques numerados con etiquetas claras.'
    );
  }

  if (hints.length === 0) return "";
  return "\n\nPistas adicionales:\n" + hints.map((h) => `- ${h}`).join("\n");
}

/**
 * Híbrido: Excel estructurado (determinista) → LLM con pistas semánticas.
 * Nunca devuelve vacío sin reintentar con LLM obligatorio.
 */
export async function extractElementHybrid(
  sessionId: string,
  element: ElementDef,
  options?: {
    timeoutMs?: number;
    extraHints?: string;
    skipDeterministic?: boolean;
    extractConfig?: ExtractConfig;
  }
): Promise<ExtractElementResult> {
  const structuredFiles = structuredIndexToExcelFiles(sessionId);
  let result: ExtractElementResult;
  const skipDeterministic =
    options?.skipDeterministic ||
    element.extractStrategy?.skipDeterministic === true ||
    !deterministicMethodsAllowed(element);

  if (isGanttActivitiesElement(element) && extractMethodAllowed(element, "gantt")) {
    const rawContext = getGanttSheetContext(structuredFiles);
    if (rawContext) {
      const { structureGanttActivitiesWithLlm } = await import("@/lib/gantt-llm-structure");
      const structured = await structureGanttActivitiesWithLlm(
        element,
        rawContext,
        options?.extractConfig?.structurePrompts.gantt
      );
      const content = finalizeContentForElement(structured.content, element);
      if (content) {
        result = {
          content,
          method: `llm_gantt:${structured.confidence}`,
          confidence: structured.confidence,
        };
        return ensureNonEmpty(sessionId, element, result, options);
      }
    }
    result = await runLlmExtract(
      sessionId,
      element,
      options,
      rawContext ? `\n\nDatos de la hoja de actividades (nombre y descripción):\n${rawContext}` : ""
    );
    return ensureNonEmpty(sessionId, element, result, options);
  }

  if (isGanttActivitiesElement(element) && !extractMethodAllowed(element, "gantt") && llmMethodsAllowed(element)) {
    result = await runLlmExtract(sessionId, element, options);
    return ensureNonEmpty(sessionId, element, result, options);
  }

  if (isIndicatorsTableElement(element) && extractMethodAllowed(element, "indicators")) {
    const rawContext = getIndicatorsSheetContext(structuredFiles);
    if (rawContext) {
      const { structureIndicatorsWithLlm } = await import("@/lib/indicators-llm-structure");
      const structured = await structureIndicatorsWithLlm(
        element,
        rawContext,
        options?.extractConfig?.structurePrompts.indicators
      );
      const content = finalizeContentForElement(structured.content, element);
      if (content) {
        result = {
          content,
          method: `llm_indicators:${structured.confidence}`,
          confidence: structured.confidence,
        };
        return ensureNonEmpty(sessionId, element, result, options);
      }
    }
    result = await runLlmExtract(sessionId, element, options);
    return ensureNonEmpty(sessionId, element, result, options);
  }

  if (isIndicatorsTableElement(element) && !extractMethodAllowed(element, "indicators") && llmMethodsAllowed(element)) {
    result = await runLlmExtract(sessionId, element, options);
    return ensureNonEmpty(sessionId, element, result, options);
  }

  const deterministic = skipDeterministic
    ? null
    : tryDeterministicExtract(structuredFiles, element, options?.extractConfig);
  if (deterministic?.content.trim()) {
    return ensureNonEmpty(sessionId, element, deterministic, options);
  }

  result = await runLlmExtract(sessionId, element, options);
  return ensureNonEmpty(sessionId, element, result, options);
}