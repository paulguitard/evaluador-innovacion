import type { ContextMode } from "@/lib/rag-limits";
import { CONTEXT_LIMITS } from "@/lib/rag-limits";
import { isImet } from "@/lib/eval-types/constants";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET,
} from "@/lib/eval-types/prompt-defaults";
import {
  defaultExtractAgentConfig,
  defaultExtractDuplicateGuardConfig,
  defaultExtractHeuristicConfig,
  defaultExtractHintOverrides,
  defaultExtractProjectIndexConfig,
  defaultExtractProjectRetrieveConfig,
  defaultExtractRetryConfig,
  defaultExtractVisionConfig,
  buildExtractTypeSpecificDefaults,
  DEFAULT_GANTT_STRUCTURE_PROMPT,
  DEFAULT_INDICATORS_STRUCTURE_PROMPT,
} from "@/lib/eval-types/extract-config-defaults";

export type ExtractMethod =
  | "heuristic"
  | "form_row"
  | "gantt"
  | "indicators"
  | "rag_llm"
  | "vision";

export type ElementExtractStrategy = {
  preferredMethods?: ExtractMethod[];
  llmHints?: string;
  skipDeterministic?: boolean;
  sheetPriority?: string[];
};

export type ElementDefConfig = {
  title: string;
  description: string;
  section?: string;
  extractStrategy?: ElementExtractStrategy;
};

export type PipelinePromptOverrides = {
  scoreJsonSystem?: string;
  formatInstructions?: string;
};

export type PipelineConfig = {
  indicatorLabel: string;
  charRangeMinRatio: number;
  parallelSubdimensions: boolean;
  parallelDimensions: boolean;
  maxTokens: {
    dimensionOverview: number;
    subdimension: number;
    formatReport: number;
    scoreJson: number;
    summary: number;
  };
  prompts: PipelinePromptOverrides;
};

export type RagModeOverride = {
  topK?: number;
  maxRetrievedChars?: number;
  maxSystemChars?: number;
};

export type RagConfig = {
  chunkSizeChars: number;
  overlapChars: number;
  queryLimits: {
    ragQueryPromptChars: number;
    ragQueryRubricChars: number;
  };
  modes: Partial<Record<ContextMode, RagModeOverride>>;
};

export type ExtractPromptOverrides = {
  /** System prompt del agente de extracción LLM+tools. Vacío = default IGIP/IMET en código. */
  system?: string;
};

export type ExtractAgentConfig = {
  maxToolIterations: number;
  maxTokens: number;
  temperature: number;
  /** Placeholders: {{title}}, {{section}}, {{description}}, {{extraHints}} */
  userPromptTemplate: string;
  fallbackTopK: number;
  fallbackMaxRetrievedChars: number;
  toolSearchTopK: number;
  toolSearchMaxRetrievedChars: number;
};

export type ExtractProjectIndexConfig = {
  chunkSizeChars: number;
  overlapChars: number;
};

export type ExtractProjectRetrieveConfig = {
  topK: number;
  maxRetrievedChars: number;
  neighborWindow: number;
};

export type ExtractDuplicateGuardConfig = {
  minCompareChars: number;
  similarityThreshold: number;
  /** Placeholders: {{elementTitle}}, {{otherTitles}}, {{preview}} */
  retryHintBody: string;
};

export type ExtractRetryConfig = {
  emptyRetryExtraTimeoutMs: number;
};

export type ExtractHeuristicConfig = {
  highConfidenceMin: number;
  minUsableConfidence: number;
};

export type ExtractVisionConfig = {
  indexPrompt: string;
};

export type ExtractHintOverrides = {
  mandatoryRetryIgip: string;
  mandatoryRetryImet: string;
};

export type ExtractConfig = {
  elementTimeoutMs: number;
  sheetPatterns: {
    gantt: string;
    indicators: string;
    resumen: string;
  };
  structurePrompts: {
    gantt: string;
    indicators: string;
  };
  prompts?: ExtractPromptOverrides;
  agent: ExtractAgentConfig;
  projectIndex: ExtractProjectIndexConfig;
  projectRetrieve: ExtractProjectRetrieveConfig;
  duplicateGuard: ExtractDuplicateGuardConfig;
  retry: ExtractRetryConfig;
  heuristics: ExtractHeuristicConfig;
  vision: ExtractVisionConfig;
  hintOverrides: ExtractHintOverrides;
};

export type EvaluationTypeSettings = {
  pipeline: PipelineConfig;
  rag: RagConfig;
  extract: ExtractConfig;
};

export function defaultPipelineConfig(indicatorLabel = "IGIP"): PipelineConfig {
  return {
    indicatorLabel,
    charRangeMinRatio: 0.9,
    parallelSubdimensions: true,
    parallelDimensions: true,
    maxTokens: {
      dimensionOverview: 4000,
      subdimension: 8000,
      formatReport: 8192,
      scoreJson: 1024,
      summary: 600,
    },
    prompts: {},
  };
}

const CHAT_CONTEXT_MODES: ContextMode[] = [
  "chat-config",
  "chat-knowledge",
  "chat-chapter",
  "chat-project",
];

export function defaultRagConfig(): RagConfig {
  const modes: RagConfig["modes"] = {};
  for (const mode of CHAT_CONTEXT_MODES) {
    const l = CONTEXT_LIMITS[mode];
    modes[mode] = {
      topK: l.topK,
      maxRetrievedChars: l.maxRetrievedChars,
      maxSystemChars: l.maxSystemChars,
    };
  }
  return {
    chunkSizeChars: 1000,
    overlapChars: 150,
    queryLimits: {
      ragQueryPromptChars: 500,
      ragQueryRubricChars: 500,
    },
    modes,
  };
}

export function defaultExtractConfig(): ExtractConfig {
  return {
    elementTimeoutMs: 45_000,
    sheetPatterns: {
      gantt: "gantt|cronograma|carta\\s*gantt|plan\\s+de\\s+actividad",
      indicators: "indicador",
      resumen: "resumen|ficha|informaci[oó]n\\s*general",
    },
    structurePrompts: {
      gantt: DEFAULT_GANTT_STRUCTURE_PROMPT,
      indicators: DEFAULT_INDICATORS_STRUCTURE_PROMPT,
    },
    prompts: {
      system: "",
    },
    agent: defaultExtractAgentConfig(),
    projectIndex: defaultExtractProjectIndexConfig(),
    projectRetrieve: defaultExtractProjectRetrieveConfig(),
    duplicateGuard: defaultExtractDuplicateGuardConfig(),
    retry: defaultExtractRetryConfig(),
    heuristics: defaultExtractHeuristicConfig(),
    vision: defaultExtractVisionConfig(),
    hintOverrides: defaultExtractHintOverrides(),
  };
}

export function defaultEvaluationTypeSettings(indicatorLabel = "IGIP"): EvaluationTypeSettings {
  return {
    pipeline: defaultPipelineConfig(indicatorLabel),
    rag: defaultRagConfig(),
    extract: defaultExtractConfig(),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function mergePipelineConfig(
  raw: Partial<PipelineConfig> | null | undefined,
  indicatorLabel: string
): PipelineConfig {
  const base = defaultPipelineConfig(indicatorLabel);
  if (!raw || typeof raw !== "object") return base;
  return {
    indicatorLabel:
      typeof raw.indicatorLabel === "string" && raw.indicatorLabel.trim()
        ? raw.indicatorLabel.trim()
        : base.indicatorLabel,
    charRangeMinRatio: clamp(Number(raw.charRangeMinRatio ?? base.charRangeMinRatio), 0.5, 1),
    parallelSubdimensions: raw.parallelSubdimensions ?? base.parallelSubdimensions,
    parallelDimensions: raw.parallelDimensions ?? base.parallelDimensions,
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
      scoreJson: clamp(Number(raw.maxTokens?.scoreJson ?? base.maxTokens.scoreJson), 256, 16_000),
      summary: clamp(Number(raw.maxTokens?.summary ?? base.maxTokens.summary), 128, 16_000),
    },
    prompts: {
      scoreJsonSystem:
        typeof raw.prompts?.scoreJsonSystem === "string" ? raw.prompts.scoreJsonSystem : "",
      formatInstructions:
        typeof raw.prompts?.formatInstructions === "string" ? raw.prompts.formatInstructions : "",
    },
  };
}

function mergeRagConfig(raw: Partial<RagConfig> | null | undefined): RagConfig {
  const base = defaultRagConfig();
  if (!raw || typeof raw !== "object") return base;
  const modes: RagConfig["modes"] = { ...base.modes };
  if (raw.modes && typeof raw.modes === "object") {
    for (const [key, val] of Object.entries(raw.modes)) {
      if (!val || typeof val !== "object") continue;
      const mode = key as ContextMode;
      if (mode === "evaluate") continue;
      const existing = modes[mode] ?? {};
      modes[mode] = {
        topK: val.topK != null ? clamp(Number(val.topK), 0, 100) : existing.topK,
        maxRetrievedChars:
          val.maxRetrievedChars != null
            ? clamp(Number(val.maxRetrievedChars), 0, 500_000)
            : existing.maxRetrievedChars,
        maxSystemChars:
          val.maxSystemChars != null
            ? clamp(Number(val.maxSystemChars), 1000, 500_000)
            : existing.maxSystemChars,
      };
    }
  }
  delete modes.evaluate;
  const chunkSizeChars = clamp(Number(raw.chunkSizeChars ?? base.chunkSizeChars), 200, 8000);
  const overlapChars = clamp(
    Number(raw.overlapChars ?? base.overlapChars),
    0,
    Math.min(2000, chunkSizeChars)
  );
  return {
    chunkSizeChars,
    overlapChars,
    queryLimits: {
      ragQueryPromptChars: clamp(
        Number(raw.queryLimits?.ragQueryPromptChars ?? base.queryLimits.ragQueryPromptChars),
        100,
        10_000
      ),
      ragQueryRubricChars: clamp(
        Number(raw.queryLimits?.ragQueryRubricChars ?? base.queryLimits.ragQueryRubricChars),
        100,
        10_000
      ),
    },
    modes,
  };
}

function baseExtractForType(typeName?: string): ExtractConfig {
  const base = defaultExtractConfig();
  const typed = buildExtractTypeSpecificDefaults(typeName);
  const system = isImet(typeName)
    ? DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET
    : DEFAULT_EXTRACT_SYSTEM_PROMPT;
  return {
    ...base,
    ...typed,
    prompts: { system },
  };
}

function mergeExtractConfig(
  raw: Partial<ExtractConfig> | null | undefined,
  typeName?: string
): ExtractConfig {
  const base = baseExtractForType(typeName);
  if (!raw || typeof raw !== "object") return base;
  return {
    elementTimeoutMs: clamp(Number(raw.elementTimeoutMs ?? base.elementTimeoutMs), 5000, 300_000),
    sheetPatterns: {
      gantt:
        typeof raw.sheetPatterns?.gantt === "string"
          ? raw.sheetPatterns.gantt
          : base.sheetPatterns.gantt,
      indicators:
        typeof raw.sheetPatterns?.indicators === "string"
          ? raw.sheetPatterns.indicators
          : base.sheetPatterns.indicators,
      resumen:
        typeof raw.sheetPatterns?.resumen === "string"
          ? raw.sheetPatterns.resumen
          : base.sheetPatterns.resumen,
    },
    structurePrompts: {
      gantt:
        typeof raw.structurePrompts?.gantt === "string"
          ? raw.structurePrompts.gantt
          : base.structurePrompts.gantt,
      indicators:
        typeof raw.structurePrompts?.indicators === "string"
          ? raw.structurePrompts.indicators
          : base.structurePrompts.indicators,
    },
    prompts: {
      system: (() => {
        const custom =
          typeof raw.prompts?.system === "string" ? raw.prompts.system.trim() : "";
        return custom || base.prompts?.system || "";
      })(),
    },
    agent: {
      maxToolIterations: clamp(
        Number(raw.agent?.maxToolIterations ?? base.agent.maxToolIterations),
        1,
        20
      ),
      maxTokens: clamp(Number(raw.agent?.maxTokens ?? base.agent.maxTokens), 256, 32_768),
      temperature: clamp(Number(raw.agent?.temperature ?? base.agent.temperature), 0, 1),
      userPromptTemplate:
        typeof raw.agent?.userPromptTemplate === "string" && raw.agent.userPromptTemplate.trim()
          ? raw.agent.userPromptTemplate
          : base.agent.userPromptTemplate,
      fallbackTopK: clamp(Number(raw.agent?.fallbackTopK ?? base.agent.fallbackTopK), 1, 50),
      fallbackMaxRetrievedChars: clamp(
        Number(raw.agent?.fallbackMaxRetrievedChars ?? base.agent.fallbackMaxRetrievedChars),
        1000,
        100_000
      ),
      toolSearchTopK: clamp(Number(raw.agent?.toolSearchTopK ?? base.agent.toolSearchTopK), 1, 50),
      toolSearchMaxRetrievedChars: clamp(
        Number(raw.agent?.toolSearchMaxRetrievedChars ?? base.agent.toolSearchMaxRetrievedChars),
        1000,
        100_000
      ),
    },
    projectIndex: {
      chunkSizeChars: clamp(
        Number(raw.projectIndex?.chunkSizeChars ?? base.projectIndex.chunkSizeChars),
        200,
        8000
      ),
      overlapChars: clamp(
        Number(raw.projectIndex?.overlapChars ?? base.projectIndex.overlapChars),
        0,
        2000
      ),
    },
    projectRetrieve: {
      topK: clamp(Number(raw.projectRetrieve?.topK ?? base.projectRetrieve.topK), 1, 50),
      maxRetrievedChars: clamp(
        Number(raw.projectRetrieve?.maxRetrievedChars ?? base.projectRetrieve.maxRetrievedChars),
        1000,
        100_000
      ),
      neighborWindow: clamp(
        Number(raw.projectRetrieve?.neighborWindow ?? base.projectRetrieve.neighborWindow),
        0,
        5
      ),
    },
    duplicateGuard: {
      minCompareChars: clamp(
        Number(raw.duplicateGuard?.minCompareChars ?? base.duplicateGuard.minCompareChars),
        20,
        500
      ),
      similarityThreshold: clamp(
        Number(raw.duplicateGuard?.similarityThreshold ?? base.duplicateGuard.similarityThreshold),
        0.5,
        1
      ),
      retryHintBody:
        typeof raw.duplicateGuard?.retryHintBody === "string" && raw.duplicateGuard.retryHintBody.trim()
          ? raw.duplicateGuard.retryHintBody
          : base.duplicateGuard.retryHintBody,
    },
    retry: {
      emptyRetryExtraTimeoutMs: clamp(
        Number(raw.retry?.emptyRetryExtraTimeoutMs ?? base.retry.emptyRetryExtraTimeoutMs),
        0,
        120_000
      ),
    },
    heuristics: {
      highConfidenceMin: clamp(
        Number(raw.heuristics?.highConfidenceMin ?? base.heuristics.highConfidenceMin),
        0.1,
        1
      ),
      minUsableConfidence: clamp(
        Number(raw.heuristics?.minUsableConfidence ?? base.heuristics.minUsableConfidence),
        0.1,
        1
      ),
    },
    vision: {
      indexPrompt:
        typeof raw.vision?.indexPrompt === "string" && raw.vision.indexPrompt.trim()
          ? raw.vision.indexPrompt
          : base.vision.indexPrompt,
    },
    hintOverrides: {
      mandatoryRetryIgip:
        typeof raw.hintOverrides?.mandatoryRetryIgip === "string" &&
        raw.hintOverrides.mandatoryRetryIgip.trim()
          ? raw.hintOverrides.mandatoryRetryIgip
          : base.hintOverrides.mandatoryRetryIgip,
      mandatoryRetryImet:
        typeof raw.hintOverrides?.mandatoryRetryImet === "string" &&
        raw.hintOverrides.mandatoryRetryImet.trim()
          ? raw.hintOverrides.mandatoryRetryImet
          : base.hintOverrides.mandatoryRetryImet,
    },
  };
}

export function mergeEvaluationTypeSettings(
  raw: {
    pipeline_config?: unknown;
    rag_config?: unknown;
    extract_config?: unknown;
  } | null | undefined,
  typeName?: string
): EvaluationTypeSettings {
  const label = typeName?.trim() || "IGIP";
  return {
    pipeline: mergePipelineConfig(
      raw?.pipeline_config as Partial<PipelineConfig> | undefined,
      label
    ),
    rag: mergeRagConfig(raw?.rag_config as Partial<RagConfig> | undefined),
    extract: mergeExtractConfig(raw?.extract_config as Partial<ExtractConfig> | undefined, label),
  };
}

export function parseElementDefConfig(raw: unknown): ElementDefConfig | null {
  if (!raw || typeof raw !== "object" || !("title" in raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  if (!title.trim()) return null;
  const extractStrategy =
    o.extractStrategy && typeof o.extractStrategy === "object"
      ? (o.extractStrategy as ElementExtractStrategy)
      : undefined;
  return {
    title: title.trim(),
    description: typeof o.description === "string" ? o.description : "",
    section: typeof o.section === "string" ? o.section : "General",
    extractStrategy,
  };
}
