import { loadChunksAsync, loadChunksMetaAsync } from "@/lib/vector-store";
import { headKnowledgeChunksBlob } from "@/lib/blob-chunk-store";
import {
  clearOrphanKnowledgeIndex,
  isKnowledgeConfigured,
} from "@/lib/knowledge-config";
import { ragStatusFromMeta, type RagStatusStats } from "@/lib/rag-status-utils";
export { ragStatusFromMeta } from "@/lib/rag-status-utils";
export type { RagStatusStats } from "@/lib/rag-status-utils";

export type RagStatus = RagStatusStats & {
  knowledgeConfigured: boolean;
  chunksDownloadUrl: string | null;
};

export async function getRagStatus(evaluationTypeId: number): Promise<RagStatus> {
  const knowledgeConfigured = await isKnowledgeConfigured(evaluationTypeId);
  if (!knowledgeConfigured) {
    await clearOrphanKnowledgeIndex(evaluationTypeId);
    return {
      hasIndex: false,
      chunkCount: 0,
      indexedAt: null,
      knowledgeVersion: null,
      chunksFileBytes: 0,
      knowledgeConfigured: false,
      chunksDownloadUrl: null,
    };
  }

  const meta = await loadChunksMetaAsync(evaluationTypeId);
  let chunkCount = meta?.chunkCount;
  let chunksFileBytes = meta?.chunksFileBytes;
  const headInfo = await headKnowledgeChunksBlob(evaluationTypeId);

  if (chunksFileBytes == null && headInfo) {
    chunksFileBytes = headInfo.size;
  }

  if (chunkCount == null) {
    const chunks = await loadChunksAsync(evaluationTypeId);
    chunkCount = chunks.length;
    if (chunksFileBytes == null) {
      chunksFileBytes = chunks.length > 0 ? JSON.stringify(chunks).length : 0;
    }
  }

  const stats = ragStatusFromMeta(meta, { chunkCount, chunksFileBytes });

  return {
    ...stats,
    knowledgeConfigured: true,
    chunksDownloadUrl: headInfo?.url ?? null,
  };
}
