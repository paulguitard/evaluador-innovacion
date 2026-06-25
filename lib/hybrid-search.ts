import type { StoredChunk } from "@/lib/vector-store";
import { embedQuery } from "@/lib/embeddings";

export type RetrievedChunk = StoredChunk & { score: number };

export type HybridRetrieveOptions = {
  topK?: number;
  maxRetrievedChars?: number;
  hybridVectorWeight?: number;
};

const HYBRID_CANDIDATE_MULTIPLIER = 2.5;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

function keywordScore(query: string, chunkText: string): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const cTokens = tokenize(chunkText);
  if (cTokens.length === 0) return 0;
  let hits = 0;
  for (const t of cTokens) {
    if (qTokens.has(t)) hits += 1;
  }
  return hits / Math.sqrt(cTokens.length * qTokens.size);
}

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

/**
 * Búsqueda híbrida (embeddings + keywords) sobre un conjunto de chunks en memoria.
 */
export async function hybridRetrieve(
  chunks: StoredChunk[],
  queryText: string,
  options: HybridRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? 12;
  const maxChars = options.maxRetrievedChars ?? 12_000;
  const vectorWeight = options.hybridVectorWeight ?? 0.72;
  const keywordWeight = 1 - vectorWeight;

  if (chunks.length === 0 || !queryText.trim()) return [];

  const queryEmbedding = await embedQuery(queryText);
  const candidateCount = Math.min(chunks.length, Math.ceil(topK * HYBRID_CANDIDATE_MULTIPLIER));

  const scored = chunks.map((chunk) => {
    const vec = cosineSimilarity(chunk.embedding, queryEmbedding);
    const kw = keywordScore(queryText, chunk.text);
    const score = vectorWeight * vec + keywordWeight * kw;
    return { ...chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, candidateCount);

  const selected: RetrievedChunk[] = [];
  let totalChars = 0;
  for (const r of candidates) {
    if (selected.length >= topK) break;
    if (totalChars + r.text.length > maxChars && selected.length > 0) break;
    selected.push(r);
    totalChars += r.text.length;
  }
  return selected;
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fuzzyMatchScore(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const aTokens = new Set(na.split(" ").filter((t) => t.length >= 3));
  const bTokens = nb.split(" ").filter((t) => t.length >= 3);
  if (bTokens.length === 0) return 0;
  let hits = 0;
  for (const t of bTokens) {
    if (aTokens.has(t)) hits += 1;
  }
  return hits / bTokens.length;
}
