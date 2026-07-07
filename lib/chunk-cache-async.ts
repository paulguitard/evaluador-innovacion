import type { StoredChunk } from "@/lib/vector-store";

const TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  chunks: StoredChunk[];
  loadedAt: number;
};

const cache = new Map<string, CacheEntry>();

export async function getCachedChunksAsync(
  key: string,
  loader: () => Promise<StoredChunk[]>
): Promise<StoredChunk[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < TTL_MS) return hit.chunks;
  const chunks = await loader();
  cache.set(key, { chunks, loadedAt: Date.now() });
  return chunks;
}

export function invalidateAsyncChunkCache(key: string): void {
  cache.delete(key);
}

/** Solo para tests. */
export function clearAsyncChunkCache(): void {
  cache.clear();
}
