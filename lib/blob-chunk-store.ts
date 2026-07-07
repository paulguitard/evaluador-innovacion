import "server-only";

import { head, put } from "@vercel/blob";
import {
  knowledgeVectorsBlobPath,
  useBlobStorage,
} from "@/lib/blob-storage";
import type { KnowledgeIndexMeta, StoredChunk } from "@/lib/vector-store";

const CHUNKS_FILE = "chunks.json";
const META_FILE = "meta.json";

async function fetchBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    const meta = await head(pathname);
    if (!meta?.url) return null;
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function putBlobJson(pathname: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data);
  await put(pathname, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** HEAD sin descargar el cuerpo (solo metadata/size). */
export async function headKnowledgeBlob(pathname: string): Promise<{ size: number } | null> {
  if (!useBlobStorage()) return null;
  try {
    const meta = await head(pathname);
    if (!meta) return null;
    return { size: meta.size };
  } catch {
    return null;
  }
}

export async function headKnowledgeChunksBlob(
  evaluationTypeId: number
): Promise<{ size: number; url: string } | null> {
  if (!useBlobStorage()) return null;
  try {
    const pathname = knowledgeVectorsBlobPath(evaluationTypeId, CHUNKS_FILE);
    const meta = await head(pathname);
    if (!meta?.url) return null;
    return { size: meta.size, url: meta.url };
  } catch {
    return null;
  }
}

export async function loadKnowledgeChunksFromBlob(
  evaluationTypeId: number
): Promise<StoredChunk[] | null> {
  if (!useBlobStorage()) return null;
  const data = await fetchBlobJson<StoredChunk[]>(
    knowledgeVectorsBlobPath(evaluationTypeId, CHUNKS_FILE)
  );
  return Array.isArray(data) ? data : null;
}

export async function loadKnowledgeMetaFromBlob(
  evaluationTypeId: number
): Promise<KnowledgeIndexMeta | null> {
  if (!useBlobStorage()) return null;
  return fetchBlobJson<KnowledgeIndexMeta>(
    knowledgeVectorsBlobPath(evaluationTypeId, META_FILE)
  );
}

export async function saveKnowledgeChunksToBlob(
  evaluationTypeId: number,
  chunks: StoredChunk[],
  meta?: KnowledgeIndexMeta
): Promise<void> {
  if (!useBlobStorage()) return;
  await putBlobJson(knowledgeVectorsBlobPath(evaluationTypeId, CHUNKS_FILE), chunks);
  if (meta) {
    await putBlobJson(knowledgeVectorsBlobPath(evaluationTypeId, META_FILE), meta);
  }
}

export async function clearKnowledgeVectorsBlob(evaluationTypeId: number): Promise<void> {
  if (!useBlobStorage()) return;
  const emptyBody = "[]";
  await saveKnowledgeChunksToBlob(
    evaluationTypeId,
    [],
    {
      indexedAt: new Date().toISOString(),
      knowledgeVersion: "empty",
      chunkCount: 0,
      chunksFileBytes: emptyBody.length,
    }
  );
}
