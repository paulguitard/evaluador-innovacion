import { getKnowledgePageSegments } from "@/lib/knowledge-loader";
import { chunkText } from "@/lib/chunking";
import { embedTexts } from "@/lib/embeddings";
import { loadChunksAsync, saveChunks, type StoredChunk } from "@/lib/vector-store";
import { detectPrintedPageInText } from "@/lib/page-lookup";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";

export type IndexKnowledgeResult = { chunkCount: number };

export type IndexKnowledgeOptions = {
  /** Solo re-indexar estos documentos; conserva chunks del resto. */
  reindexDocNames?: string[];
};

function segmentsToStoredChunks(
  segments: { docName: string; text: string; page?: number }[],
  chunkSize: number,
  overlap: number
): { allChunks: ReturnType<typeof chunkText>; texts: string[] } {
  const allChunks: ReturnType<typeof chunkText> = [];
  for (const { docName, text, page } of segments) {
    const chunks = chunkText(text, docName, {
      chunkSizeChars: chunkSize,
      overlapChars: overlap,
      page,
    });
    allChunks.push(...chunks);
  }
  return { allChunks, texts: allChunks.map((c) => c.text) };
}

function mapChunksToStored(
  allChunks: ReturnType<typeof chunkText>,
  embeddings: number[][]
): StoredChunk[] {
  return allChunks.map((chunk, i) => {
    const printedPage = detectPrintedPageInText(chunk.text, chunk.page);
    return {
      id: `${chunk.docName}-${chunk.page ?? "n"}-${chunk.index}`,
      docName: chunk.docName,
      text: chunk.text,
      embedding: embeddings[i] ?? [],
      ...(chunk.page != null ? { page: chunk.page } : {}),
      ...(printedPage != null ? { printedPage } : {}),
    };
  });
}

/**
 * Index knowledge documents: extract text, chunk, embed, store.
 * Con reindexDocNames solo re-embebe documentos nuevos/cambiados.
 */
export async function indexKnowledge(
  evaluationTypeId: number,
  options: IndexKnowledgeOptions = {}
): Promise<IndexKnowledgeResult> {
  const settings = await getEvaluationTypeSettings(evaluationTypeId);
  const chunkSize = settings.rag.chunkSizeChars;
  const overlap = settings.rag.overlapChars;
  const segments = await getKnowledgePageSegments(evaluationTypeId);
  const currentDocNames = [...new Set(segments.map((s) => s.docName))];

  if (segments.length === 0) {
    await saveChunks(evaluationTypeId, [], {
      indexedAt: new Date().toISOString(),
      knowledgeVersion: "empty",
    });
    return { chunkCount: 0 };
  }

  const reindexSet = options.reindexDocNames?.length
    ? new Set(options.reindexDocNames)
    : new Set(currentDocNames);

  const existing = await loadChunksAsync(evaluationTypeId);
  const kept = existing.filter((c) => currentDocNames.includes(c.docName) && !reindexSet.has(c.docName));

  const segmentsToIndex = segments.filter((s) => reindexSet.has(s.docName));
  if (segmentsToIndex.length === 0 && kept.length > 0) {
    await saveChunks(evaluationTypeId, kept, {
      indexedAt: new Date().toISOString(),
      knowledgeVersion: JSON.stringify(currentDocNames),
    });
    return { chunkCount: kept.length };
  }

  const { allChunks, texts } = segmentsToStoredChunks(segmentsToIndex, chunkSize, overlap);
  if (allChunks.length === 0) {
    const merged = kept;
    await saveChunks(evaluationTypeId, merged, {
      indexedAt: new Date().toISOString(),
      knowledgeVersion: JSON.stringify(currentDocNames),
    });
    return { chunkCount: merged.length };
  }

  const embeddings = await embedTexts(texts);
  const newStored = mapChunksToStored(allChunks, embeddings);
  const stored = [...kept, ...newStored];

  await saveChunks(evaluationTypeId, stored, {
    indexedAt: new Date().toISOString(),
    knowledgeVersion: JSON.stringify(currentDocNames),
  });
  return { chunkCount: stored.length };
}
