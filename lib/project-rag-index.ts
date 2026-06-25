import path from "path";
import fs from "fs";
import { chunkText } from "@/lib/chunking";
import { embedTexts } from "@/lib/embeddings";
import { extractTextFromFile, extractPdfPages } from "@/lib/document-parser";
import { extractTextWithVision } from "@/lib/extract-with-vision";
import { extractExcelToStructuredJson } from "@/lib/excel-structured-extract";
import { saveProjectChunks } from "@/lib/project-vector-store";
import type { StoredChunk } from "@/lib/vector-store";

const CHUNK_SIZE = 900;
const OVERLAP = 120;
const VISION_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export type IndexProjectResult = { chunkCount: number };

function excelSheetToText(
  fileName: string,
  sheet: { sheetName: string; cells: Array<{ row: number; col: number; value: string }> }
): string {
  const cells = [...sheet.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const lines = cells.map((c) => `(fila ${c.row}, col ${c.col}): ${c.value}`);
  return `### ${fileName} — Hoja: ${sheet.sheetName}\n${lines.join("\n")}`;
}

async function extractFileSegments(
  filePath: string
): Promise<Array<{ docName: string; text: string; page?: number }>> {
  if (!fs.existsSync(filePath)) return [];
  const docName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const pages = await extractPdfPages(filePath);
    if (pages.length > 0) {
      return pages.map((p) => ({ docName, text: p.text, page: p.page }));
    }
    const text = await extractTextFromFile(filePath);
    return text ? [{ docName, text }] : [];
  }

  if (ext === ".xlsx") {
    try {
      const data = await extractExcelToStructuredJson(filePath);
      const parts = data.sheets.map((s) => excelSheetToText(docName, s));
      const combined = parts.join("\n\n");
      return combined ? [{ docName, text: combined }] : [];
    } catch {
      const text = await extractTextFromFile(filePath);
      return text ? [{ docName, text }] : [];
    }
  }

  if (VISION_EXTS.has(ext)) {
    const text = await extractTextWithVision(filePath);
    if (!text || text.startsWith("[")) return [];
    return [{ docName, text }];
  }

  const plain = await extractTextFromFile(filePath);
  if (!plain || plain.startsWith("[")) return [];
  return [{ docName, text: plain }];
}

/**
 * Indexa archivos del proyecto para extracción RAG (por sesión, independiente del Knowledge).
 */
export async function indexProjectFiles(
  sessionId: string,
  filePaths: string[]
): Promise<IndexProjectResult> {
  const validPaths = filePaths.filter((p) => p && fs.existsSync(p));
  if (validPaths.length === 0) {
    saveProjectChunks(sessionId, [], {
      indexedAt: new Date().toISOString(),
      filePaths: [],
    });
    return { chunkCount: 0 };
  }

  const segments: Array<{ docName: string; text: string; page?: number }> = [];
  for (const filePath of validPaths) {
    const segs = await extractFileSegments(filePath);
    segments.push(...segs);
  }

  if (segments.length === 0) {
    saveProjectChunks(sessionId, [], {
      indexedAt: new Date().toISOString(),
      filePaths: validPaths,
    });
    return { chunkCount: 0 };
  }

  const allChunks: ReturnType<typeof chunkText> = [];
  for (const { docName, text, page } of segments) {
    const chunks = chunkText(text, docName, {
      chunkSizeChars: CHUNK_SIZE,
      overlapChars: OVERLAP,
      page,
    });
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    saveProjectChunks(sessionId, [], {
      indexedAt: new Date().toISOString(),
      filePaths: validPaths,
    });
    return { chunkCount: 0 };
  }

  const embeddings = await embedTexts(allChunks.map((c) => c.text));
  const stored: StoredChunk[] = allChunks.map((chunk, i) => ({
    id: `proj-${chunk.docName}-${chunk.page ?? "n"}-${chunk.index}`,
    docName: chunk.docName,
    text: chunk.text,
    embedding: embeddings[i] ?? [],
    ...(chunk.page != null ? { page: chunk.page } : {}),
  }));

  saveProjectChunks(sessionId, stored, {
    indexedAt: new Date().toISOString(),
    filePaths: validPaths,
  });

  return { chunkCount: stored.length };
}
