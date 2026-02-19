import path from "path";
import fs from "fs";
import { getVectorsDir } from "@/lib/storage";

export type StoredChunk = {
  id: string;
  docName: string;
  text: string;
  embedding: number[];
};

const CHUNKS_FILE = "chunks.json";
const META_FILE = "meta.json";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function saveChunks(
  evaluationTypeId: number,
  chunks: StoredChunk[],
  meta?: { indexedAt: string; knowledgeVersion?: string }
): void {
  const dir = getVectorsDir(evaluationTypeId);
  const chunksPath = path.join(dir, CHUNKS_FILE);
  fs.writeFileSync(chunksPath, JSON.stringify(chunks), "utf-8");
  if (meta) {
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta), "utf-8");
  }
}

export function loadChunks(evaluationTypeId: number): StoredChunk[] {
  const dir = getVectorsDir(evaluationTypeId);
  const chunksPath = path.join(dir, CHUNKS_FILE);
  if (!fs.existsSync(chunksPath)) return [];
  try {
    const raw = fs.readFileSync(chunksPath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function hasChunks(evaluationTypeId: number): boolean {
  const chunks = loadChunks(evaluationTypeId);
  return chunks.length > 0;
}

export type SearchResult = StoredChunk & { score: number };

export function search(
  evaluationTypeId: number,
  queryEmbedding: number[],
  topK: number
): SearchResult[] {
  const chunks = loadChunks(evaluationTypeId);
  if (chunks.length === 0) return [];

  const withScores = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(chunk.embedding, queryEmbedding),
  }));
  withScores.sort((a, b) => b.score - a.score);
  return withScores.slice(0, topK);
}
