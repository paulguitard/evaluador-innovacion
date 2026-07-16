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
import {
  buildElementLlmHints,
  getMandatoryRetryHint,
} from "@/lib/eval-types/extract-hints";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET,
} from "@/lib/eval-types/prompt-defaults";
import { isImet } from "@/lib/eval-types/constants";

export type ExtractElementResult = {
  content: string;
  method: string;
  confidence: string;
};

export type HybridExtractOptions = {
  timeoutMs?: number;
  extraHints?: string;
  skipDeterministic?: boolean;
  extractConfig?: ExtractConfig;
  /** Nombre del tipo de evaluación (IGIP / IMET) para pistas y reintento hardcodeados. */
  evaluationTypeName?: string | null;
};

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
  options?: HybridExtractOptions,
  extraHints = ""
): Promise<ExtractElementResult> {
  const hints = buildElementLlmHints(element, options?.evaluationTypeName);
  const combinedHints = hints + (options?.extraHints ?? "") + extraHints;
  const customSystem = options?.extractConfig?.prompts?.system?.trim();
  const systemPrompt =
    customSystem ||
    (isImet(options?.evaluationTypeName)
      ? DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET
      : DEFAULT_EXTRACT_SYSTEM_PROMPT);
  const { extractElementLlmFirst } = await import("@/lib/project-extract-llm");
  return extractElementLlmFirst(sessionId, element, {
    timeoutMs: options?.timeoutMs,
    extraHints: combinedHints,
    systemPrompt,
    extractConfig: options?.extractConfig,
  });
}

/** Si el resultado está vacío, reintenta con LLM obligatorio. */
async function ensureNonEmpty(
  sessionId: string,
  element: ElementDef,
  result: ExtractElementResult,
  options?: HybridExtractOptions
): Promise<ExtractElementResult> {
  if (result.content.trim()) return result;

  const retryHint = getMandatoryRetryHint(
    options?.evaluationTypeName,
    options?.extractConfig?.hintOverrides
  );
  const retry = await runLlmExtract(sessionId, element, {
    timeoutMs: (options?.timeoutMs ?? 45_000) + (options?.extractConfig?.retry.emptyRetryExtraTimeoutMs ?? 20_000),
    extractConfig: options?.extractConfig,
    evaluationTypeName: options?.evaluationTypeName,
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

  const highConfidenceMin = extractConfig?.heuristics.highConfidenceMin ?? 0.72;
  if (isHighConfidenceHeuristic(heuristic.confidence, highConfidenceMin)) {
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

/**
 * Híbrido: Excel estructurado (determinista) → LLM con pistas semánticas.
 * Nunca devuelve vacío sin reintentar con LLM obligatorio.
 */
export async function extractElementHybrid(
  sessionId: string,
  element: ElementDef,
  options?: HybridExtractOptions
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