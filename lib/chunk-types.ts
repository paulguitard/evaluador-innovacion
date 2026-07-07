/** Tipos de chunks RAG compartidos cliente/servidor (sin dependencias server-only). */

export type StoredChunk = {
  id: string;
  docName: string;
  text: string;
  embedding: number[];
  page?: number;
  printedPage?: number;
};

export type RetrievedChunk = StoredChunk & { score: number };

export type KnowledgeIndexMeta = {
  indexedAt: string;
  knowledgeVersion?: string;
  chunkCount?: number;
  chunksFileBytes?: number;
};
