import type { RetrievedChunk, StoredChunk } from "@/lib/chunk-types";
import {
  knowledgeChunkQualityAdjustments,
  mergeRetrievedChunks,
  scoreChunks,
  type HybridRetrieveOptions,
} from "@/lib/hybrid-search-core";

export type ClientHybridRetrieveOptions = HybridRetrieveOptions;

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await fetch("/api/embed-queries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Error al obtener embeddings (${res.status})`
    );
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  return Array.isArray(data.embeddings) ? data.embeddings : [];
}

/**
 * Búsqueda híbrida en el navegador (misma lógica que servidor; embeddings vía API).
 */
export async function clientHybridRetrieve(
  chunks: StoredChunk[],
  queryText: string,
  options: ClientHybridRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const filtered = options.excludeIds
    ? chunks.filter((c) => !options.excludeIds!.has(c.id))
    : chunks;
  if (filtered.length === 0 || !queryText.trim()) return [];

  const [queryEmbedding] = await fetchEmbeddings([queryText]);
  return scoreChunks(filtered, queryText, queryEmbedding ?? [], {
    ...options,
    scoreAdjust: options.scoreAdjust ?? ((c) => knowledgeChunkQualityAdjustments(c.text)),
  });
}

export async function clientHybridRetrieveMulti(
  chunks: StoredChunk[],
  queryTexts: string[],
  options: ClientHybridRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const queries = [...new Set(queryTexts.map((q) => q.trim()).filter(Boolean))];
  if (queries.length === 0) return [];
  if (queries.length === 1) {
    return clientHybridRetrieve(chunks, queries[0], options);
  }

  const filtered = options.excludeIds
    ? chunks.filter((c) => !options.excludeIds!.has(c.id))
    : chunks;
  if (filtered.length === 0) return [];

  const topK = options.topK ?? 12;
  const maxChars = options.maxRetrievedChars ?? 12_000;
  const embeddings = await fetchEmbeddings(queries);
  const scoreAdjust =
    options.scoreAdjust ?? ((c: StoredChunk) => knowledgeChunkQualityAdjustments(c.text));
  const batches: RetrievedChunk[] = [];

  for (let i = 0; i < queries.length; i++) {
    const batch = scoreChunks(filtered, queries[i], embeddings[i] ?? [], {
      ...options,
      scoreAdjust,
      topK: Math.ceil(topK / queries.length) + 8,
      maxRetrievedChars: Math.ceil(maxChars / queries.length) + 4000,
    });
    batches.push(...batch);
  }

  return mergeRetrievedChunks(batches, topK, maxChars);
}
