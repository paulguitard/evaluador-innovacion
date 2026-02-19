import { getKnowledgeDocuments } from "@/lib/knowledge-loader";
import { chunkText, type TextChunk } from "@/lib/chunking";
import { embedTexts } from "@/lib/embeddings";
import { saveChunks, type StoredChunk } from "@/lib/vector-store";

const CHUNK_SIZE = 1000;
const OVERLAP = 150;

/**
 * Index all knowledge documents for an evaluation type: extract text, chunk, embed, store.
 */
export async function indexKnowledge(evaluationTypeId: number): Promise<void> {
  const docs = await getKnowledgeDocuments(evaluationTypeId);
  if (docs.length === 0) {
    saveChunks(evaluationTypeId, [], {
      indexedAt: new Date().toISOString(),
      knowledgeVersion: "empty",
    });
    return;
  }

  const allChunks: TextChunk[] = [];
  for (const { docName, text } of docs) {
    const chunks = chunkText(text, docName, {
      chunkSizeChars: CHUNK_SIZE,
      overlapChars: OVERLAP,
    });
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    saveChunks(evaluationTypeId, [], {
      indexedAt: new Date().toISOString(),
      knowledgeVersion: JSON.stringify(docs.map((d) => d.docName)),
    });
    return;
  }

  const texts = allChunks.map((c) => c.text);
  const embeddings = await embedTexts(texts);

  const stored: StoredChunk[] = allChunks.map((chunk, i) => ({
    id: `${chunk.docName}-${chunk.index}`,
    docName: chunk.docName,
    text: chunk.text,
    embedding: embeddings[i] ?? [],
  }));

  saveChunks(evaluationTypeId, stored, {
    indexedAt: new Date().toISOString(),
    knowledgeVersion: JSON.stringify(docs.map((d) => d.docName)),
  });
}
