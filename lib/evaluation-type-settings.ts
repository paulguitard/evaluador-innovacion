import type { ContextMode } from "@/lib/rag-limits";
import { CONTEXT_LIMITS } from "@/lib/rag-limits";

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
  dimensionLabels: string[];
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

export type ExtractConfig = {
  elementTimeoutMs: number;
  mandatoryLlmRetryHint: string;
  globalLlmHints: string;
  sheetPatterns: {
    gantt: string;
    indicators: string;
    resumen: string;
  };
  structurePrompts: {
    gantt: string;
    indicators: string;
  };
};

export type EvaluationTypeSettings = {
  pipeline: PipelineConfig;
  rag: RagConfig;
  extract: ExtractConfig;
};

const DEFAULT_GANTT_STRUCTURE_PROMPT = `Eres un asistente que estructura la carta Gantt / plan de actividades de proyectos.

Recibirás datos de la hoja Excel con nombres y descripciones de actividades.

REGLAS OBLIGATORIAS:
- Lista numerada (1, 2, 3…) con una actividad por bloque.
- Cada actividad incluye ÚNICAMENTE:
  • Nombre de la actividad
  • Descripción de la actividad
- NO incluyas: tareas, subtareas, responsables, fechas, duración, % avance, evidencias ni columnas extra.
- NO copies párrafos de desarrollo técnico ni texto de otras hojas.
- NO inventes actividades; solo usa los datos proporcionados.
- Omite encabezados de tabla, filas vacías y filas de subtareas ("Tareas:").
- Respeta la descripción del elemento configurada por el usuario.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

const DEFAULT_INDICATORS_STRUCTURE_PROMPT = `Eres un asistente que estructura tablas de indicadores de proyectos.

Recibirás datos crudos de la hoja Excel "Indicadores" (filas con etiquetas de columna).
Tu tarea es reescribirlos de forma clara y legible para un evaluador humano.

REGLAS DE FORMATO:
- Un bloque numerado por cada indicador (1, 2, 3…).
- Dentro de cada bloque usa etiquetas en líneas separadas.
- NO uses pipes (|), tablas de una sola línea ni listas compactas ilegibles.
- NO inventes datos; solo reorganiza fielmente lo que aparece en los datos crudos.
- Omite campos vacíos.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

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
    dimensionLabels: [
      "Novedad",
      "Potencial de impacto",
      "Escalabilidad",
      "Resultado final",
    ],
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
    mandatoryLlmRetryHint: `

IMPORTANTE: Este campo NO puede quedar vacío. Usa las herramientas para revisar todo el proyecto (hoja Resumen Proyecto, Gantt, Indicadores, PDF). Si no encuentras el texto exacto del título, busca por la descripción del elemento y sinónimos.`,
    globalLlmHints:
      'En bitácoras Excel, busca en la tabla superior (columna A/B) etiquetas como "Sede", "Escuelas", "Carreras". El valor suele estar en la columna adyacente.',
    sheetPatterns: {
      gantt: "gantt|cronograma|carta\\s*gantt|plan\\s+de\\s+actividad",
      indicators: "indicador",
      resumen: "resumen|ficha|informaci[oó]n\\s*general",
    },
    structurePrompts: {
      gantt: DEFAULT_GANTT_STRUCTURE_PROMPT,
      indicators: DEFAULT_INDICATORS_STRUCTURE_PROMPT,
    },
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
    dimensionLabels: Array.isArray(raw.dimensionLabels)
      ? raw.dimensionLabels.filter((l): l is string => typeof l === "string" && !!l.trim())
      : base.dimensionLabels,
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

function mergeExtractConfig(raw: Partial<ExtractConfig> | null | undefined): ExtractConfig {
  const base = defaultExtractConfig();
  if (!raw || typeof raw !== "object") return base;
  return {
    elementTimeoutMs: clamp(Number(raw.elementTimeoutMs ?? base.elementTimeoutMs), 5000, 300_000),
    mandatoryLlmRetryHint:
      typeof raw.mandatoryLlmRetryHint === "string"
        ? raw.mandatoryLlmRetryHint
        : base.mandatoryLlmRetryHint,
    globalLlmHints:
      typeof raw.globalLlmHints === "string" ? raw.globalLlmHints : base.globalLlmHints,
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
    extract: mergeExtractConfig(raw?.extract_config as Partial<ExtractConfig> | undefined),
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
