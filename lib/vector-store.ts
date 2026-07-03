import path from "path";
import { getVectorsDir } from "@/lib/storage";
import {
  loadChunksFromStore,
  loadMetaFromStore,
  saveChunksToStore,
  type ChunkStoreConfig,
} from "@/lib/chunk-store";
import {
  loadKnowledgeChunksFromBlob,
  loadKnowledgeMetaFromBlob,
  saveKnowledgeChunksToBlob,
} from "@/lib/blob-chunk-store";
import { useBlobStorage } from "@/lib/blob-storage";

export type StoredChunk = {
  id: string;
  docName: string;
  text: string;
  embedding: number[];
  /** Número de página del PDF (1-based), si está disponible. */
  page?: number;
  /** Número de página impresa en el documento (cabecera Oslo: | 201). */
  printedPage?: number;
};

const CHUNKS_FILE = "chunks.json";
const META_FILE = "meta.json";

export type KnowledgeIndexMeta = {
  indexedAt: string;
  knowledgeVersion?: string;
};

function storeConfig(evaluationTypeId: number): ChunkStoreConfig {
  return {
    kind: "knowledge",
    id: evaluationTypeId,
    dir: getVectorsDir(evaluationTypeId),
    chunksFile: CHUNKS_FILE,
    metaFile: META_FILE,
  };
}

function loadChunksFromDisk(evaluationTypeId: number): StoredChunk[] {
  return loadChunksFromStore(storeConfig(evaluationTypeId));
}

/** Carga chunks: en Blob primero; en local, disco y luego Blob. */
export async function loadChunksAsync(evaluationTypeId: number): Promise<StoredChunk[]> {
  if (useBlobStorage()) {
    const fromBlob = await loadKnowledgeChunksFromBlob(evaluationTypeId);
    if (fromBlob && fromBlob.length > 0) return fromBlob;
  }
  return loadChunksFromDisk(evaluationTypeId);
}

/** @deprecated Prefer loadChunksAsync en serverless. */
export function loadChunks(evaluationTypeId: number): StoredChunk[] {
  return loadChunksFromDisk(evaluationTypeId);
}

export async function loadChunksMetaAsync(
  evaluationTypeId: number
): Promise<KnowledgeIndexMeta | null> {
  if (useBlobStorage()) {
    const fromBlob = await loadKnowledgeMetaFromBlob(evaluationTypeId);
    if (fromBlob) return fromBlob;
  }
  return loadMetaFromStore<KnowledgeIndexMeta>(storeConfig(evaluationTypeId));
}

export function loadChunksMeta(evaluationTypeId: number): KnowledgeIndexMeta | null {
  return loadMetaFromStore<KnowledgeIndexMeta>(storeConfig(evaluationTypeId));
}

export async function saveChunks(
  evaluationTypeId: number,
  chunks: StoredChunk[],
  meta?: KnowledgeIndexMeta
): Promise<void> {
  if (useBlobStorage()) {
    await saveKnowledgeChunksToBlob(evaluationTypeId, chunks, meta);
    return;
  }
  saveChunksToStore(storeConfig(evaluationTypeId), chunks, meta);
}

export async function hasChunksAsync(evaluationTypeId: number): Promise<boolean> {
  const chunks = await loadChunksAsync(evaluationTypeId);
  return chunks.length > 0;
}

export function hasChunks(evaluationTypeId: number): boolean {
  return loadChunks(evaluationTypeId).length > 0;
}
