import { CONTEXT_LIMITS } from "@/lib/rag-limits";
import type { PipelineConfig } from "@/lib/evaluation-type-settings";
import type { RagConfig } from "@/lib/evaluation-type-settings";
import type { ReportFormatConfig } from "@/lib/report-format-config";

/** @deprecated Legacy — el resumen macro vive solo en §6 (report_format_config). */
export const DEFAULT_EVAL_DIMENSION_OVERVIEW_PHASE = "";

export const DEFAULT_EVAL_SUBDIMENSION_PHASE =
  "Evaluación técnica y rigurosa del criterio: análisis detallado contrastando proyecto y rúbrica con el Knowledge; justificación fundamentada; sugerencias de mejora concretas; asignación de nota según escala.";

export const DEFAULT_EVAL_ASSIGNED_LEVEL_PHASE =
  "Asignación de nivel global con análisis de evidencia del proyecto y justificación técnica fundamentada en el Knowledge y la escala de niveles.";

export type CharLimits = { minChars: number; maxChars: number };

export type EvaluationPhaseInstructions = {
  dimensionOverview: string;
  subdimensionEval: string;
  assignedLevel: string;
};

export type EvaluationOutputLimits = {
  dimensionOverview: CharLimits;
  subdimensionEval: CharLimits;
  assignedLevel: CharLimits;
};

export type EvaluationRagMode = {
  topK?: number;
  maxRetrievedChars?: number;
  maxSystemChars?: number;
};

export type EvaluationPromptOverrides = {
  scoreJsonSystem?: string;
  formatInstructions?: string;
};

export type EvaluationConfig = {
  indicatorLabel: string;
  parallelSubdimensions: boolean;
  parallelDimensions: boolean;
  charRangeMinRatio: number;
  maxTokens: {
    dimensionOverview: number;
    subdimension: number;
    formatReport: number;
    scoreJson: number;
    summary: number;
  };
  knowledgeReferenceLabel: string;
  projectElementsInRagQuery: number;
  phaseInstructions: EvaluationPhaseInstructions;
  outputLimits: EvaluationOutputLimits;
  ragEvaluate: EvaluationRagMode;
  prompts: EvaluationPromptOverrides;
};

const DEFAULT_DIM_OVERVIEW: CharLimits = { minChars: 400, maxChars: 500 };
const DEFAULT_SUB_EVAL: CharLimits = { minChars: 1200, maxChars: 1500 };
const DEFAULT_ASSIGNED_LEVEL: CharLimits = { minChars: 1500, maxChars: 2000 };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampLimits(minChars: number, maxChars: number): CharLimits {
  const max = Math.max(1, Math.round(maxChars));
  const min = Math.min(max, Math.max(1, Math.round(minChars)));
  return { minChars: min, maxChars: max };
}

export function defaultEvaluationConfig(indicatorLabel = "IGIP"): EvaluationConfig {
  const evaluateDefaults = CONTEXT_LIMITS.evaluate;
  return {
    indicatorLabel,
    parallelSubdimensions: true,
    parallelDimensions: true,
    charRangeMinRatio: 0.9,
    maxTokens: {
      dimensionOverview: 4000,
      subdimension: 8000,
      formatReport: 8192,
      scoreJson: 1024,
      summary: 600,
    },
    knowledgeReferenceLabel: "Manual de referencia",
    projectElementsInRagQuery: 8,
    phaseInstructions: {
      dimensionOverview: "",
      subdimensionEval: DEFAULT_EVAL_SUBDIMENSION_PHASE,
      assignedLevel: DEFAULT_EVAL_ASSIGNED_LEVEL_PHASE,
    },
    outputLimits: {
      dimensionOverview: { ...DEFAULT_DIM_OVERVIEW },
      subdimensionEval: { ...DEFAULT_SUB_EVAL },
      assignedLevel: { ...DEFAULT_ASSIGNED_LEVEL },
    },
    ragEvaluate: {
      topK: evaluateDefaults.topK,
      maxRetrievedChars: evaluateDefaults.maxRetrievedChars,
      maxSystemChars: evaluateDefaults.maxSystemChars,
    },
    prompts: {},
  };
}

function mergeFromPipeline(
  base: EvaluationConfig,
  pipeline?: Partial<PipelineConfig> | null
): EvaluationConfig {
  if (!pipeline || typeof pipeline !== "object") return base;
  return {
    ...base,
    indicatorLabel:
      typeof pipeline.indicatorLabel === "string" && pipeline.indicatorLabel.trim()
        ? pipeline.indicatorLabel.trim()
        : base.indicatorLabel,
    parallelSubdimensions: pipeline.parallelSubdimensions ?? base.parallelSubdimensions,
    parallelDimensions: pipeline.parallelDimensions ?? base.parallelDimensions,
    charRangeMinRatio: clamp(
      Number(pipeline.charRangeMinRatio ?? base.charRangeMinRatio),
      0.5,
      1
    ),
    maxTokens: {
      dimensionOverview: clamp(
        Number(pipeline.maxTokens?.dimensionOverview ?? base.maxTokens.dimensionOverview),
        256,
        128_000
      ),
      subdimension: clamp(
        Number(pipeline.maxTokens?.subdimension ?? base.maxTokens.subdimension),
        256,
        128_000
      ),
      formatReport: clamp(
        Number(pipeline.maxTokens?.formatReport ?? base.maxTokens.formatReport),
        256,
        128_000
      ),
      scoreJson: clamp(
        Number(pipeline.maxTokens?.scoreJson ?? base.maxTokens.scoreJson),
        256,
        16_000
      ),
      summary: clamp(
        Number(pipeline.maxTokens?.summary ?? base.maxTokens.summary),
        128,
        16_000
      ),
    },
    prompts: {
      scoreJsonSystem:
        typeof pipeline.prompts?.scoreJsonSystem === "string"
          ? pipeline.prompts.scoreJsonSystem
          : base.prompts.scoreJsonSystem ?? "",
      formatInstructions:
        typeof pipeline.prompts?.formatInstructions === "string"
          ? pipeline.prompts.formatInstructions
          : base.prompts.formatInstructions ?? "",
    },
  };
}

function mergeFromReportFormat(
  base: EvaluationConfig,
  reportFormat?: Partial<ReportFormatConfig> | null
): EvaluationConfig {
  if (!reportFormat || typeof reportFormat !== "object") return base;
  return {
    ...base,
    phaseInstructions: {
      ...base.phaseInstructions,
      subdimensionEval:
        reportFormat.subdimensionEvalInstructions?.trim() ||
        base.phaseInstructions.subdimensionEval,
      assignedLevel:
        reportFormat.assignedLevelInstructions?.trim() ||
        base.phaseInstructions.assignedLevel,
    },
    outputLimits: {
      ...base.outputLimits,
      subdimensionEval: reportFormat.subdimensionEvalLimits
        ? clampLimits(
            reportFormat.subdimensionEvalLimits.minChars,
            reportFormat.subdimensionEvalLimits.maxChars
          )
        : base.outputLimits.subdimensionEval,
      assignedLevel: reportFormat.assignedLevelLimits
        ? clampLimits(
            reportFormat.assignedLevelLimits.minChars,
            reportFormat.assignedLevelLimits.maxChars
          )
        : base.outputLimits.assignedLevel,
    },
  };
}

function mergeFromRag(base: EvaluationConfig, rag?: Partial<RagConfig> | null): EvaluationConfig {
  if (!rag?.modes?.evaluate) return base;
  const ev = rag.modes.evaluate;
  return {
    ...base,
    ragEvaluate: {
      topK: ev.topK != null ? clamp(Number(ev.topK), 0, 100) : base.ragEvaluate.topK,
      maxRetrievedChars:
        ev.maxRetrievedChars != null
          ? clamp(Number(ev.maxRetrievedChars), 0, 500_000)
          : base.ragEvaluate.maxRetrievedChars,
      maxSystemChars:
        ev.maxSystemChars != null
          ? clamp(Number(ev.maxSystemChars), 1000, 500_000)
          : base.ragEvaluate.maxSystemChars,
    },
  };
}

function mergeRawEvaluationConfig(
  raw: Partial<EvaluationConfig> | null | undefined,
  base: EvaluationConfig
): EvaluationConfig {
  if (!raw || typeof raw !== "object") return base;
  return {
    indicatorLabel:
      typeof raw.indicatorLabel === "string" && raw.indicatorLabel.trim()
        ? raw.indicatorLabel.trim()
        : base.indicatorLabel,
    parallelSubdimensions: raw.parallelSubdimensions ?? base.parallelSubdimensions,
    parallelDimensions: raw.parallelDimensions ?? base.parallelDimensions,
    charRangeMinRatio: clamp(Number(raw.charRangeMinRatio ?? base.charRangeMinRatio), 0.5, 1),
    maxTokens: {
      dimensionOverview: clamp(
        Number(raw.maxTokens?.dimensionOverview ?? base.maxTokens.dimensionOverview),
        256,
        128_000
      ),
      subdimension: clamp(
        Number(raw.maxTokens?.subdimension ?? base.maxTokens.subdimension),
        256,
        128_000
      ),
      formatReport: clamp(
        Number(raw.maxTokens?.formatReport ?? base.maxTokens.formatReport),
        256,
        128_000
      ),
      scoreJson: clamp(
        Number(raw.maxTokens?.scoreJson ?? base.maxTokens.scoreJson),
        256,
        16_000
      ),
      summary: clamp(Number(raw.maxTokens?.summary ?? base.maxTokens.summary), 128, 16_000),
    },
    knowledgeReferenceLabel:
      typeof raw.knowledgeReferenceLabel === "string" && raw.knowledgeReferenceLabel.trim()
        ? raw.knowledgeReferenceLabel.trim()
        : base.knowledgeReferenceLabel,
    projectElementsInRagQuery: clamp(
      Number(raw.projectElementsInRagQuery ?? base.projectElementsInRagQuery),
      1,
      50
    ),
    phaseInstructions: {
      dimensionOverview:
        raw.phaseInstructions?.dimensionOverview?.trim() ||
        base.phaseInstructions.dimensionOverview,
      subdimensionEval:
        raw.phaseInstructions?.subdimensionEval?.trim() ||
        base.phaseInstructions.subdimensionEval,
      assignedLevel:
        raw.phaseInstructions?.assignedLevel?.trim() || base.phaseInstructions.assignedLevel,
    },
    outputLimits: {
      dimensionOverview: raw.outputLimits?.dimensionOverview
        ? clampLimits(
            raw.outputLimits.dimensionOverview.minChars,
            raw.outputLimits.dimensionOverview.maxChars
          )
        : base.outputLimits.dimensionOverview,
      subdimensionEval: raw.outputLimits?.subdimensionEval
        ? clampLimits(
            raw.outputLimits.subdimensionEval.minChars,
            raw.outputLimits.subdimensionEval.maxChars
          )
        : base.outputLimits.subdimensionEval,
      assignedLevel: raw.outputLimits?.assignedLevel
        ? clampLimits(
            raw.outputLimits.assignedLevel.minChars,
            raw.outputLimits.assignedLevel.maxChars
          )
        : base.outputLimits.assignedLevel,
    },
    ragEvaluate: {
      topK:
        raw.ragEvaluate?.topK != null
          ? clamp(Number(raw.ragEvaluate.topK), 0, 100)
          : base.ragEvaluate.topK,
      maxRetrievedChars:
        raw.ragEvaluate?.maxRetrievedChars != null
          ? clamp(Number(raw.ragEvaluate.maxRetrievedChars), 0, 500_000)
          : base.ragEvaluate.maxRetrievedChars,
      maxSystemChars:
        raw.ragEvaluate?.maxSystemChars != null
          ? clamp(Number(raw.ragEvaluate.maxSystemChars), 1000, 500_000)
          : base.ragEvaluate.maxSystemChars,
    },
    prompts: {
      scoreJsonSystem:
        typeof raw.prompts?.scoreJsonSystem === "string"
          ? raw.prompts.scoreJsonSystem
          : base.prompts.scoreJsonSystem ?? "",
      formatInstructions:
        typeof raw.prompts?.formatInstructions === "string"
          ? raw.prompts.formatInstructions
          : base.prompts.formatInstructions ?? "",
    },
  };
}

export type EvaluationConfigMergeSources = {
  evaluation_config?: unknown;
  pipeline_config?: unknown;
  report_format_config?: unknown;
  rag_config?: unknown;
};

/** Merge con prioridad: evaluation_config > pipeline/report/rag legacy. */
export function mergeEvaluationConfig(
  sources: EvaluationConfigMergeSources | null | undefined,
  typeName?: string
): EvaluationConfig {
  const label = typeName?.trim() || "IGIP";
  let base = defaultEvaluationConfig(label);

  const pipeline = sources?.pipeline_config as Partial<PipelineConfig> | undefined;
  const reportFormat = sources?.report_format_config as Partial<ReportFormatConfig> | undefined;
  const rag = sources?.rag_config as Partial<RagConfig> | undefined;

  base = mergeFromPipeline(base, pipeline);
  base = mergeFromReportFormat(base, reportFormat);
  base = mergeFromRag(base, rag);

  const raw = sources?.evaluation_config as Partial<EvaluationConfig> | undefined;
  return mergeRawEvaluationConfig(raw, base);
}

/** @deprecated Ya no sincroniza; límites e instrucciones de informe viven solo en report_format_config (§6). */
export function applyEvaluationConfigToReportFormat(
  reportFormat: ReportFormatConfig,
  _evaluationConfig: EvaluationConfig
): ReportFormatConfig {
  return reportFormat;
}

/** Construye evaluation_config desde fuentes legacy (para migración). */
export function buildEvaluationConfigFromLegacy(
  sources: Omit<EvaluationConfigMergeSources, "evaluation_config">,
  typeName?: string
): EvaluationConfig {
  return mergeEvaluationConfig(sources, typeName);
}

export function isEvaluationConfigEmpty(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t === "" || t === "{}";
  }
  if (typeof raw === "object") return Object.keys(raw as object).length === 0;
  return true;
}
