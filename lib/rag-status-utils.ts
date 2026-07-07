import type { KnowledgeIndexMeta } from "@/lib/chunk-types";

export type RagStatusStats = {
  hasIndex: boolean;
  chunkCount: number;
  indexedAt: string | null;
  knowledgeVersion: string | null;
  chunksFileBytes: number;
};

/** Deriva estadísticas RAG desde meta + fallback opcional (sin I/O). */
export function ragStatusFromMeta(
  meta: KnowledgeIndexMeta | null,
  fallback?: { chunkCount?: number; chunksFileBytes?: number }
): RagStatusStats {
  const chunkCount = meta?.chunkCount ?? fallback?.chunkCount ?? 0;
  const chunksFileBytes = meta?.chunksFileBytes ?? fallback?.chunksFileBytes ?? 0;
  return {
    chunkCount,
    chunksFileBytes,
    hasIndex: chunkCount > 0,
    indexedAt: meta?.indexedAt ?? null,
    knowledgeVersion: meta?.knowledgeVersion ?? null,
  };
}
