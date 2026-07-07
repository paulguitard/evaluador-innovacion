import {
  loadKnowledgeChunksFromBlob,
  loadKnowledgeMetaFromBlob,
  saveKnowledgeChunksToBlob,
  clearKnowledgeVectorsBlob,
} from "@/lib/blob-chunk-store";
import { assertBlobStorageConfigured } from "@/lib/blob-storage";
import { chunkCacheKey } from "@/lib/chunk-cache";
import {
  getCachedChunksAsync,
  invalidateAsyncChunkCache,
} from "@/lib/chunk-cache-async";
import type { KnowledgeIndexMeta, StoredChunk } from "@/lib/chunk-types";

export type { KnowledgeIndexMeta, StoredChunk } from "@/lib/chunk-types";

function buildMetaWithStats(
  chunks: StoredChunk[],
  meta?: KnowledgeIndexMeta
): KnowledgeIndexMeta {
  const body = JSON.stringify(chunks);
  return {
    indexedAt: meta?.indexedAt ?? new Date().toISOString(),
    knowledgeVersion: meta?.knowledgeVersion,
    chunkCount: chunks.length,
    chunksFileBytes: body.length,
  };
}

/** Carga chunks del índice RAG desde Vercel Blob (con caché en memoria por instancia). */
export async function loadChunksAsync(evaluationTypeId: number): Promise<StoredChunk[]> {
  const key = chunkCacheKey("knowledge", evaluationTypeId);
  return getCachedChunksAsync(key, async () => {
    const fromBlob = await loadKnowledgeChunksFromBlob(evaluationTypeId);
    return fromBlob ?? [];
  });
}

/** @deprecated Prefer loadChunksAsync. */
export function loadChunks(evaluationTypeId: number): StoredChunk[] {
  throw new Error("loadChunks síncrono no disponible; use loadChunksAsync.");
}

export async function loadChunksMetaAsync(
  evaluationTypeId: number
): Promise<KnowledgeIndexMeta | null> {
  return loadKnowledgeMetaFromBlob(evaluationTypeId);
}

export function loadChunksMeta(_evaluationTypeId: number): KnowledgeIndexMeta | null {
  throw new Error("loadChunksMeta síncrono no disponible; use loadChunksMetaAsync.");
}

export async function saveChunks(
  evaluationTypeId: number,
  chunks: StoredChunk[],
  meta?: KnowledgeIndexMeta
): Promise<void> {
  assertBlobStorageConfigured();
  const enrichedMeta = buildMetaWithStats(chunks, meta);
  await saveKnowledgeChunksToBlob(evaluationTypeId, chunks, enrichedMeta);
  invalidateAsyncChunkCache(chunkCacheKey("knowledge", evaluationTypeId));
  if (chunks.length === 0) {
    await clearKnowledgeVectorsBlob(evaluationTypeId);
  }
}

export async function hasChunksAsync(evaluationTypeId: number): Promise<boolean> {
  const chunks = await loadChunksAsync(evaluationTypeId);
  return chunks.length > 0;
}

export function hasChunks(_evaluationTypeId: number): boolean {
  throw new Error("hasChunks síncrono no disponible; use hasChunksAsync.");
}
