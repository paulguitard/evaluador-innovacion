import { embedQuery } from "@/lib/embeddings";
import { search, type StoredChunk } from "@/lib/vector-store";

export type RetrievedChunk = StoredChunk & { score: number };

export type RetrieveOptions = {
  topK?: number;
  maxRetrievedChars?: number;
};

const DEFAULT_TOP_K = 25;
const DEFAULT_MAX_CHARS = 18_000;

/**
 * Retrieve the most relevant knowledge chunks for a query, up to maxRetrievedChars.
 */
export async function retrieveRelevantChunks(
  evaluationTypeId: number,
  queryText: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const maxChars = options.maxRetrievedChars ?? DEFAULT_MAX_CHARS;

  const queryEmbedding = await embedQuery(queryText);
  const results = search(evaluationTypeId, queryEmbedding, topK);

  const selected: RetrievedChunk[] = [];
  let totalChars = 0;
  for (const r of results) {
    if (totalChars + r.text.length > maxChars) break;
    selected.push(r);
    totalChars += r.text.length;
  }
  return selected;
}
