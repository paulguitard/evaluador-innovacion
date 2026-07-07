import type { RetrievedChunk, StoredChunk } from "@/lib/chunk-types";
import { embedQuery, embedTexts } from "@/lib/embeddings";
import {
  mergeRetrievedChunks,
  scoreChunks,
  type HybridRetrieveOptions,
} from "@/lib/hybrid-search-core";

export type { RetrievedChunk } from "@/lib/chunk-types";
export {
  cosineSimilarity,
  keywordScore,
  knowledgeChunkQualityAdjustments,
  scoreChunks,
  mergeRetrievedChunks,
  type HybridRetrieveOptions,
} from "@/lib/hybrid-search-core";

/**
 * Búsqueda híbrida (embeddings + keywords) sobre un conjunto de chunks en memoria.
 */
export async function hybridRetrieve(
  chunks: StoredChunk[],
  queryText: string,
  options: HybridRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const filtered = options.excludeIds
    ? chunks.filter((c) => !options.excludeIds!.has(c.id))
    : chunks;
  if (filtered.length === 0 || !queryText.trim()) return [];
  const queryEmbedding = await embedQuery(queryText);
  return scoreChunks(filtered, queryText, queryEmbedding, options);
}

/**
 * Varias consultas con un solo batch de embeddings (reduce llamadas API).
 */
export async function hybridRetrieveMulti(
  chunks: StoredChunk[],
  queryTexts: string[],
  options: HybridRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const queries = [...new Set(queryTexts.map((q) => q.trim()).filter(Boolean))];
  if (queries.length === 0) return [];
  if (queries.length === 1) {
    return hybridRetrieve(chunks, queries[0], options);
  }

  const filtered = options.excludeIds
    ? chunks.filter((c) => !options.excludeIds!.has(c.id))
    : chunks;
  if (filtered.length === 0) return [];

  const topK = options.topK ?? 12;
  const maxChars = options.maxRetrievedChars ?? 12_000;
  const embeddings = await embedTexts(queries);
  const batches: RetrievedChunk[] = [];

  for (let i = 0; i < queries.length; i++) {
    const queryText = queries[i];
    const queryEmbedding = embeddings[i] ?? [];
    const batch = scoreChunks(filtered, queryText, queryEmbedding, {
      ...options,
      topK: Math.ceil(topK / queries.length) + 8,
      maxRetrievedChars: Math.ceil(maxChars / queries.length) + 4000,
    });
    batches.push(...batch);
  }

  return mergeRetrievedChunks(batches, topK, maxChars);
}
