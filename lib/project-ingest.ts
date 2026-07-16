import { indexProjectFiles } from "@/lib/project-rag-index";
import {
  buildProjectStructuredIndex,
  saveProjectStructuredIndex,
} from "@/lib/project-structured-index";

import type { ExtractConfig } from "@/lib/evaluation-type-settings";

export type IngestProjectResult = {
  chunkCount: number;
  structuredFileCount: number;
};

/**
 * Ingesta completa del proyecto al subir: parsing técnico estructurado + índice RAG.
 */
export async function ingestProjectFiles(
  sessionId: string,
  filePaths: string[],
  extractConfig?: ExtractConfig
): Promise<IngestProjectResult> {
  const structured = await buildProjectStructuredIndex(filePaths);
  saveProjectStructuredIndex(sessionId, structured);
  const { chunkCount } = await indexProjectFiles(sessionId, filePaths, {
    projectIndex: extractConfig?.projectIndex,
    vision: extractConfig?.vision,
  });
  return { chunkCount, structuredFileCount: structured.files.length };
}
