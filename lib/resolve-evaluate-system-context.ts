import { buildSystemContext } from "@/lib/build-context";
import type { RetrievedChunk } from "@/lib/chunk-types";
import { createEmptyArtifacts } from "@/lib/agent-tools";
import {
  buildStrictEvaluationSystemMessage,
  EvaluateSystemContextError,
  validateEvaluateSystemContext,
} from "@/lib/evaluate-system-context-strict";

export type ResolveEvaluateSystemContextParams = {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  ragQuery: string;
  evaluateSubdimension?: { dimensionName: string; name: string; content: string };
  precomputedKnowledgeChunks?: RetrievedChunk[];
  subdimensionLabel: string;
};

function buildContextOptions(
  params: ResolveEvaluateSystemContextParams,
  usePrecomputed: boolean
) {
  return {
    projectElementsTable: params.projectElementsTable,
    projectElementsOnly: true,
    excludeReportFormat: true,
    contextMode: "evaluate" as const,
    ragQuery: params.ragQuery,
    evaluateSubdimension: params.evaluateSubdimension,
    strictEvaluate: true,
    agentArtifacts:
      usePrecomputed && params.precomputedKnowledgeChunks?.length
        ? { ...createEmptyArtifacts(), knowledgeChunks: params.precomputedKnowledgeChunks }
        : undefined,
  };
}

/**
 * Ensambla y valida el system context de evaluación sin fallback ni truncado.
 * Reintenta una vez sin chunks precalculados (RAG en servidor).
 */
export async function resolveEvaluateSystemContextWithRetry(
  params: ResolveEvaluateSystemContextParams
): Promise<string> {
  const attempts: Array<{ label: string; usePrecomputed: boolean }> =
    params.precomputedKnowledgeChunks?.length
      ? [
          { label: "chunks precalculados", usePrecomputed: true },
          { label: "recuperación RAG en servidor", usePrecomputed: false },
        ]
      : [{ label: "recuperación RAG en servidor", usePrecomputed: false }];

  const errors: string[] = [];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]!;
    try {
      const systemContent = await buildSystemContext(
        params.evaluationTypeId,
        [],
        buildContextOptions(params, attempt.usePrecomputed)
      );
      validateEvaluateSystemContext(systemContent, {
        subdimensionLabel: params.subdimensionLabel,
      });
      return buildStrictEvaluationSystemMessage(systemContent);
    } catch (err) {
      const msg =
        err instanceof EvaluateSystemContextError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push(`Intento ${i + 1} (${attempt.label}): ${msg}`);
    }
  }

  throw new EvaluateSystemContextError(
    ["reintentos agotados"],
    `No se pudo ensamblar el contexto de evaluación para «${params.subdimensionLabel}» tras ${attempts.length} intentos.\n${errors.join("\n")}`
  );
}
