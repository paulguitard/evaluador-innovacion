#!/usr/bin/env npx tsx
/**
 * Rellena chunkCount y chunksFileBytes en meta.json para índices RAG existentes.
 * Descarga chunks.json una sola vez por tipo y actualiza meta sin reindexar PDFs.
 *
 * Uso:
 *   npm run backfill:rag-meta
 */

import fs from "fs";
import path from "path";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const { getEvaluationTypes } = await import("../lib/db");
  const { isKnowledgeConfigured } = await import("../lib/knowledge-config");
  const { loadChunksAsync, loadChunksMetaAsync, saveChunks } = await import("../lib/vector-store");

  const types = await getEvaluationTypes();
  let updated = 0;
  let skipped = 0;

  for (const type of types) {
    if (!(await isKnowledgeConfigured(type.id))) {
      skipped++;
      continue;
    }
    const meta = await loadChunksMetaAsync(type.id);
    if (
      typeof meta?.chunkCount === "number" &&
      typeof meta?.chunksFileBytes === "number"
    ) {
      console.log(`[skip] ${type.name} (id=${type.id}): meta ya actualizado`);
      skipped++;
      continue;
    }

    const chunks = await loadChunksAsync(type.id);
    await saveChunks(type.id, chunks, {
      indexedAt: meta?.indexedAt ?? new Date().toISOString(),
      knowledgeVersion: meta?.knowledgeVersion,
    });
    console.log(
      `[ok] ${type.name} (id=${type.id}): ${chunks.length} chunks, meta actualizado`
    );
    updated++;
  }

  console.log(`Backfill RAG meta: ${updated} actualizado(s), ${skipped} omitido(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
