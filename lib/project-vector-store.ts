import path from "path";
import fs from "fs";
import { getProjectVectorsDir } from "@/lib/storage";
import type { StoredChunk } from "@/lib/vector-store";

const CHUNKS_FILE = "project-chunks.json";
const META_FILE = "project-meta.json";

export function saveProjectChunks(
  sessionId: string,
  chunks: StoredChunk[],
  meta?: { indexedAt: string; filePaths?: string[] }
): void {
  const dir = getProjectVectorsDir(sessionId);
  fs.writeFileSync(path.join(dir, CHUNKS_FILE), JSON.stringify(chunks), "utf-8");
  if (meta) {
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta), "utf-8");
  }
}

export function loadProjectChunks(sessionId: string): StoredChunk[] {
  const dir = getProjectVectorsDir(sessionId);
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

export function hasProjectChunks(sessionId: string): boolean {
  return loadProjectChunks(sessionId).length > 0;
}
