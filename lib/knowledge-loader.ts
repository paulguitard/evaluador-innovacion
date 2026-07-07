import { getConfig } from "@/lib/db";
import { extractPdfPages, extractTextFromFile } from "@/lib/document-parser";
import path from "path";
import fs from "fs";
import os from "os";

export type KnowledgeDocument = { docName: string; text: string };

export type KnowledgePageSegment = { docName: string; text: string; page?: number };

type KnowledgeBlobItem = { name: string; url: string };

function isBlobItem(item: unknown): item is KnowledgeBlobItem {
  return (
    typeof item === "object" &&
    item != null &&
    "url" in item &&
    typeof (item as KnowledgeBlobItem).url === "string" &&
    (item as KnowledgeBlobItem).url.length > 0
  );
}

async function loadFileSegments(
  fullPath: string,
  docName: string
): Promise<KnowledgePageSegment[]> {
  const ext = path.extname(fullPath).toLowerCase();
  if (ext === ".pdf") {
    const pages = await extractPdfPages(fullPath);
    if (pages.length > 0) {
      return pages.map((p) => ({ docName, text: p.text, page: p.page }));
    }
  }
  const text = await extractTextFromFile(fullPath);
  return text ? [{ docName, text }] : [];
}

async function fetchBlobToTemp(
  item: KnowledgeBlobItem,
  index: number
): Promise<string | null> {
  const docName = item.name || "documento";
  try {
    const res = await fetch(item.url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpPath = path.join(
      os.tmpdir(),
      `kb-${Date.now()}-${index}${path.extname(docName) || ".bin"}`
    );
    fs.writeFileSync(tmpPath, buf);
    return tmpPath;
  } catch {
    return null;
  }
}

function parseKnowledgePaths(raw: string | null | undefined): KnowledgeBlobItem[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBlobItem);
  } catch {
    return [];
  }
}

/**
 * Segmentos de knowledge con metadato de página (para indexación RAG).
 */
export async function getKnowledgePageSegments(
  evaluationTypeId: number
): Promise<KnowledgePageSegment[]> {
  const config = await getConfig(evaluationTypeId);
  if (!config) return [];

  const knowledgePaths = parseKnowledgePaths(config.knowledge_paths);
  if (knowledgePaths.length === 0) return [];

  const segments: KnowledgePageSegment[] = [];

  for (let i = 0; i < knowledgePaths.length; i++) {
    const item = knowledgePaths[i];
    const tmpPath = await fetchBlobToTemp(item, i);
    if (!tmpPath) continue;
    try {
      segments.push(...(await loadFileSegments(tmpPath, item.name || "documento")));
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }

  return segments;
}

/**
 * Texto de cada documento de knowledge (desde URLs de Vercel Blob).
 */
export async function getKnowledgeDocuments(evaluationTypeId: number): Promise<KnowledgeDocument[]> {
  const config = await getConfig(evaluationTypeId);
  if (!config) return [];

  const knowledgePaths = parseKnowledgePaths(config.knowledge_paths);
  if (knowledgePaths.length === 0) return [];

  const docs: KnowledgeDocument[] = [];

  for (let i = 0; i < knowledgePaths.length; i++) {
    const item = knowledgePaths[i];
    const tmpPath = await fetchBlobToTemp(item, i);
    if (!tmpPath) continue;
    try {
      const text = await extractTextFromFile(tmpPath);
      if (text) docs.push({ docName: item.name || "documento", text });
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }

  return docs;
}
