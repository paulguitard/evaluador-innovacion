import { hybridRetrieve, type RetrievedChunk } from "@/lib/hybrid-search";
import { loadProjectChunks } from "@/lib/project-vector-store";
import type { StoredChunk } from "@/lib/vector-store";

export type ProjectRetrieveOptions = {
  topK?: number;
  maxRetrievedChars?: number;
  expandNeighbors?: boolean;
};

const DEFAULT_TOP_K = 15;
const DEFAULT_MAX_CHARS = 18_000;
const NEIGHBOR_WINDOW = 1;

type ChunkKey = { docName: string; page: string; index: number };

function parseChunkKey(id: string): ChunkKey | null {
  const m = id.match(/^proj-(.+)-([^-]+)-(\d+)$/);
  if (!m) return null;
  return { docName: m[1], page: m[2], index: Number(m[3]) };
}

function chunkKeyString(key: ChunkKey): string {
  return `${key.docName}\0${key.page}\0${key.index}`;
}

/**
 * Incluye chunks adyacentes (mismo doc/página, índice ±N) para no perder contenido partido.
 */
export function expandNeighborChunks(
  selected: RetrievedChunk[],
  allChunks: StoredChunk[],
  window = NEIGHBOR_WINDOW
): RetrievedChunk[] {
  if (selected.length === 0) return [];

  const byKey = new Map<string, StoredChunk>();
  for (const c of allChunks) {
    const key = parseChunkKey(c.id);
    if (key) byKey.set(chunkKeyString(key), c);
  }

  const resultById = new Map<string, RetrievedChunk>();
  for (const chunk of selected) {
    resultById.set(chunk.id, chunk);
    const key = parseChunkKey(chunk.id);
    if (!key) continue;
    for (let delta = -window; delta <= window; delta++) {
      if (delta === 0) continue;
      const neighborKey = chunkKeyString({ ...key, index: key.index + delta });
      const neighbor = byKey.get(neighborKey);
      if (neighbor) {
        resultById.set(neighbor.id, {
          ...neighbor,
          score: chunk.score * 0.85,
        });
      }
    }
  }

  return [...resultById.values()].sort((a, b) => b.score - a.score);
}

function applyNeighborExpansion(
  chunks: RetrievedChunk[],
  allChunks: StoredChunk[],
  expand: boolean
): RetrievedChunk[] {
  if (!expand || chunks.length === 0) return chunks;
  const expanded = expandNeighborChunks(chunks, allChunks);
  return expanded;
}

function trimToMaxChars(chunks: RetrievedChunk[], maxChars: number): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  let total = 0;
  for (const c of chunks) {
    if (total + c.text.length > maxChars && selected.length > 0) break;
    selected.push(c);
    total += c.text.length;
  }
  return selected;
}

/**
 * Recupera fragmentos del índice RAG del proyecto para un elemento o consulta.
 */
export async function retrieveProjectChunks(
  sessionId: string,
  queryText: string,
  options: ProjectRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const allChunks = loadProjectChunks(sessionId);
  const topK = options.topK ?? DEFAULT_TOP_K;
  const maxChars = options.maxRetrievedChars ?? DEFAULT_MAX_CHARS;
  const expand = options.expandNeighbors !== false;

  const retrieved = await hybridRetrieve(allChunks, queryText, {
    topK,
    maxRetrievedChars: maxChars,
    hybridVectorWeight: 0.5,
  });

  const withNeighbors = applyNeighborExpansion(retrieved, allChunks, expand);
  return trimToMaxChars(withNeighbors, maxChars);
}

/**
 * Varias consultas con deduplicación; mejora recall por elemento.
 */
export async function retrieveProjectChunksMulti(
  sessionId: string,
  queryTexts: string[],
  options: ProjectRetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const queries = [...new Set(queryTexts.map((q) => q.trim()).filter(Boolean))];
  if (queries.length === 0) return [];
  if (queries.length === 1) {
    return retrieveProjectChunks(sessionId, queries[0], options);
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const maxChars = options.maxRetrievedChars ?? DEFAULT_MAX_CHARS;
  const allChunks = loadProjectChunks(sessionId);
  const byId = new Map<string, RetrievedChunk>();

  for (const q of queries) {
    const batch = await hybridRetrieve(allChunks, q, {
      topK: Math.ceil(topK / queries.length) + 8,
      maxRetrievedChars: Math.ceil(maxChars / queries.length) + 4000,
      hybridVectorWeight: 0.5,
    });
    for (const c of batch) {
      const prev = byId.get(c.id);
      if (!prev || c.score > prev.score) byId.set(c.id, c);
    }
  }

  const merged = [...byId.values()].sort((a, b) => b.score - a.score);
  const expand = options.expandNeighbors !== false;
  const withNeighbors = applyNeighborExpansion(merged.slice(0, topK + 6), allChunks, expand);
  return trimToMaxChars(withNeighbors, maxChars);
}

export function formatProjectChunksForPrompt(
  chunks: Array<{ docName: string; text: string; page?: number }>
): string {
  return chunks
    .map((c) => {
      const pageLabel = c.page != null ? ` (pág. ${c.page})` : "";
      return `### ${c.docName}${pageLabel}\n${c.text}`;
    })
    .join("\n\n---\n\n");
}
