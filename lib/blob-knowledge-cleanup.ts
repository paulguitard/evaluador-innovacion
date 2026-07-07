import "server-only";

import { del } from "@vercel/blob";
import { useBlobStorage } from "@/lib/blob-storage";
import type { KnowledgePathItem } from "@/lib/knowledge-config";

/** Elimina del Blob los archivos de knowledge que ya no están en knowledge_paths. */
export async function deleteRemovedBlobKnowledgeFiles(
  removed: KnowledgePathItem[]
): Promise<void> {
  if (!useBlobStorage()) return;
  for (const item of removed) {
    if (!item?.url) continue;
    try {
      await del(item.url);
    } catch {
      /* ignore */
    }
  }
}
