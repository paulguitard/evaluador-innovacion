import { getConfig } from "@/lib/db";
import { getKnowledgeDir } from "@/lib/storage";
import { extractTextFromFile } from "@/lib/document-parser";
import path from "path";
import fs from "fs";
import os from "os";

export type KnowledgeDocument = { docName: string; text: string };

/**
 * Load raw text for each knowledge item (local files + URLs) for the given evaluation type.
 */
export async function getKnowledgeDocuments(evaluationTypeId: number): Promise<KnowledgeDocument[]> {
  const config = await getConfig(evaluationTypeId);
  if (!config) return [];

  const knowledgePaths = (() => {
    try {
      return JSON.parse(config.knowledge_paths || "[]") as (string | { name: string; url: string })[];
    } catch {
      return [];
    }
  })();
  if (knowledgePaths.length === 0) return [];

  const dir = getKnowledgeDir(evaluationTypeId);
  const docs: KnowledgeDocument[] = [];

  for (let i = 0; i < knowledgePaths.length; i++) {
    const item = knowledgePaths[i];
    let text = "";
    let docName = "";
    if (typeof item === "object" && item?.url) {
      docName = item.name || "documento";
      try {
        const res = await fetch(item.url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const tmpPath = path.join(os.tmpdir(), `kb-${Date.now()}-${i}${path.extname(docName) || ".bin"}`);
        fs.writeFileSync(tmpPath, buf);
        try {
          text = await extractTextFromFile(tmpPath);
        } finally {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
        }
      } catch {
        continue;
      }
    } else if (typeof item === "string") {
      docName = item;
      const fullPath = path.join(dir, path.basename(item));
      if (!fs.existsSync(fullPath)) continue;
      text = await extractTextFromFile(fullPath);
    }
    if (text) docs.push({ docName, text });
  }

  return docs;
}
