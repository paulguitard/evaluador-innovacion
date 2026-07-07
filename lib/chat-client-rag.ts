import type { RetrievedChunk, StoredChunk } from "@/lib/chunk-types";
import { clientHybridRetrieveMulti } from "@/lib/client-rag";
import { buildKnowledgeRagQueries } from "@/lib/rag-query-expand";
import { fetchBulkEvaluationConfig } from "@/lib/bulk-evaluation-config-client";
import { ensureKnowledgeIndex } from "@/lib/knowledge-index-cache";

export async function retrieveKnowledgeForChat(
  evaluationTypeId: number,
  message: string
): Promise<RetrievedChunk[] | undefined> {
  const bulkConfig = await fetchBulkEvaluationConfig();
  if (!bulkConfig.useClientKnowledgeIndex) return undefined;

  const { chunks } = await ensureKnowledgeIndex(evaluationTypeId);
  const queries = buildKnowledgeRagQueries(message);
  return clientHybridRetrieveMulti(chunks, queries, {
    topK: 55,
    maxRetrievedChars: 48_000,
  });
}

export type { StoredChunk };
