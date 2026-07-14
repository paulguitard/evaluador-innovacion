import type { RetrievedChunk, StoredChunk } from "@/lib/chunk-types";
import { clientHybridRetrieve } from "@/lib/client-rag";
import { buildSubdimensionKnowledgeQuery } from "@/lib/evaluate-rag-query";
import { subdimensionScoreKey } from "@/lib/evaluation-scores";

export type EvaluatePlanSubdimension = {
  key: string;
  dimension: string;
  name: string;
  rubricContent: string;
};

export type EvaluatePlanResponse = {
  rubricType?: "ponderaciones" | "niveles";
  subdimensions: EvaluatePlanSubdimension[];
  ragEvaluate: { topK: number; maxRetrievedChars: number };
  knowledgeReferenceLabel: string;
  projectElementsInRagQuery: number;
};

export async function fetchEvaluatePlan(evaluationTypeId: number): Promise<EvaluatePlanResponse> {
  const res = await fetch(`/api/config/${evaluationTypeId}/evaluate-plan`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "No se pudo cargar el plan de evaluación");
  }
  return res.json() as Promise<EvaluatePlanResponse>;
}

export async function buildPrecomputedChunksForEvaluation(params: {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  chunks: StoredChunk[];
  plan?: EvaluatePlanResponse;
}): Promise<Record<string, RetrievedChunk[]>> {
  const plan = params.plan ?? (await fetchEvaluatePlan(params.evaluationTypeId));
  if (plan.rubricType === "niveles" && plan.subdimensions.length === 1 && plan.subdimensions[0].key === "nivel-global") {
    return {};
  }
  const out: Record<string, RetrievedChunk[]> = {};

  for (const sub of plan.subdimensions) {
    const dim: { name: string; content: string } = {
      name: sub.dimension,
      content: sub.rubricContent,
    };
    const subdim = { name: sub.name, content: sub.rubricContent };
    const query = buildSubdimensionKnowledgeQuery(
      dim,
      subdim,
      params.projectElementsTable,
      plan.projectElementsInRagQuery
    );
    const key = sub.key || subdimensionScoreKey(sub.dimension, sub.name);
    out[key] = await clientHybridRetrieve(params.chunks, query, {
      topK: plan.ragEvaluate.topK,
      maxRetrievedChars: plan.ragEvaluate.maxRetrievedChars,
    });
  }

  return out;
}
