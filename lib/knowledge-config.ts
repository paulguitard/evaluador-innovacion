import { getConfig } from "@/lib/db";
import {
  clearKnowledgeVectorsBlob,
  headKnowledgeChunksBlob,
} from "@/lib/blob-chunk-store";
import {
  loadChunksAsync,
  loadChunksMetaAsync,
  saveChunks,
  type StoredChunk,
} from "@/lib/vector-store";

export type KnowledgePathItem = { name: string; url: string };

export function parseKnowledgePaths(raw: string | null | undefined): KnowledgePathItem[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is KnowledgePathItem =>
        typeof p === "object" &&
        p != null &&
        typeof (p as KnowledgePathItem).name === "string" &&
        typeof (p as KnowledgePathItem).url === "string" &&
        (p as KnowledgePathItem).url.length > 0
    );
  } catch {
    return [];
  }
}

export function knowledgeItemKey(item: KnowledgePathItem): string {
  return item.name;
}

export async function getKnowledgePaths(evaluationTypeId: number): Promise<KnowledgePathItem[]> {
  const config = await getConfig(evaluationTypeId);
  return parseKnowledgePaths(config?.knowledge_paths);
}

export async function isKnowledgeConfigured(evaluationTypeId: number): Promise<boolean> {
  const paths = await getKnowledgePaths(evaluationTypeId);
  return paths.length > 0;
}

/**
 * Chunks del índice RAG solo si el tipo de evaluación tiene knowledge_paths configurados.
 * Evita usar un índice huérfano de otro documento o de una configuración anterior.
 */
export async function loadActiveChunks(evaluationTypeId: number): Promise<StoredChunk[]> {
  if (!(await isKnowledgeConfigured(evaluationTypeId))) return [];
  return loadChunksAsync(evaluationTypeId);
}

export async function hasActiveKnowledgeIndex(evaluationTypeId: number): Promise<boolean> {
  if (!(await isKnowledgeConfigured(evaluationTypeId))) return false;
  const meta = await loadChunksMetaAsync(evaluationTypeId);
  if (typeof meta?.chunkCount === "number") return meta.chunkCount > 0;
  const headInfo = await headKnowledgeChunksBlob(evaluationTypeId);
  if (headInfo && headInfo.size > 2) return true;
  return false;
}

/** Borra índice en Blob si ya no hay knowledge_paths (índice huérfano). */
export async function clearOrphanKnowledgeIndex(evaluationTypeId: number): Promise<boolean> {
  if (await isKnowledgeConfigured(evaluationTypeId)) return false;
  const headInfo = await headKnowledgeChunksBlob(evaluationTypeId);
  if (!headInfo || headInfo.size <= 2) return false;
  await saveChunks(evaluationTypeId, [], {
    indexedAt: new Date().toISOString(),
    knowledgeVersion: "empty",
  });
  await clearKnowledgeVectorsBlob(evaluationTypeId);
  return true;
}
