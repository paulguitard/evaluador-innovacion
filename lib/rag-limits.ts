/** Modos de construcción de contexto (chat y evaluación). */
import type { RagConfig } from "@/lib/evaluation-type-settings";

export type ContextMode =
  | "chat-config"
  | "chat-knowledge"
  | "chat-chapter"
  | "chat-project"
  | "evaluate";

export type RagLimits = {
  topK: number;
  maxRetrievedChars: number;
  maxSystemChars: number;
  skipKnowledge: boolean;
};

export const CONTEXT_LIMITS: Record<ContextMode, RagLimits> = {
  "chat-config": {
    topK: 0,
    maxRetrievedChars: 0,
    maxSystemChars: 48_000,
    skipKnowledge: true,
  },
  "chat-knowledge": {
    topK: 55,
    maxRetrievedChars: 48_000,
    maxSystemChars: 96_000,
    skipKnowledge: false,
  },
  "chat-chapter": {
    topK: 0,
    maxRetrievedChars: 64_000,
    maxSystemChars: 72_000,
    skipKnowledge: false,
  },
  "chat-project": {
    topK: 20,
    maxRetrievedChars: 14_000,
    maxSystemChars: 72_000,
    skipKnowledge: false,
  },
  evaluate: {
    topK: 55,
    maxRetrievedChars: 48_000,
    maxSystemChars: 110_000,
    skipKnowledge: false,
  },
};

export const RAG_QUERY_PROMPT_CHARS = 500;
export const RAG_QUERY_RUBRIC_CHARS = 500;

export function getContextLimits(mode: ContextMode, ragConfig?: RagConfig): RagLimits {
  const base = CONTEXT_LIMITS[mode];
  // Evaluate: §5 evaluation_config.ragEvaluate (applyEvaluateRagOverrides en build-context).
  if (mode === "evaluate") return base;
  const override = ragConfig?.modes?.[mode];
  if (!override) return base;
  return {
    ...base,
    topK: override.topK ?? base.topK,
    maxRetrievedChars: override.maxRetrievedChars ?? base.maxRetrievedChars,
    maxSystemChars: override.maxSystemChars ?? base.maxSystemChars,
  };
}

export function getRagQueryLimits(ragConfig?: RagConfig): {
  ragQueryPromptChars: number;
  ragQueryRubricChars: number;
} {
  return {
    ragQueryPromptChars:
      ragConfig?.queryLimits?.ragQueryPromptChars ?? RAG_QUERY_PROMPT_CHARS,
    ragQueryRubricChars:
      ragConfig?.queryLimits?.ragQueryRubricChars ?? RAG_QUERY_RUBRIC_CHARS,
  };
}

/** Aplica overrides de evaluation_config.ragEvaluate sobre límites del modo evaluate. */
export function applyEvaluateRagOverrides(
  limits: RagLimits,
  ragEvaluate?: { topK?: number; maxRetrievedChars?: number; maxSystemChars?: number }
): RagLimits {
  if (!ragEvaluate) return limits;
  return {
    ...limits,
    topK: ragEvaluate.topK ?? limits.topK,
    maxRetrievedChars: ragEvaluate.maxRetrievedChars ?? limits.maxRetrievedChars,
    maxSystemChars: ragEvaluate.maxSystemChars ?? limits.maxSystemChars,
  };
}
