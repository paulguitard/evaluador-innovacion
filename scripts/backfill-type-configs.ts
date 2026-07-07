#!/usr/bin/env npx tsx
/**
 * Rellena pipeline_config, rag_config y extract_config vacíos con defaults según el nombre del tipo.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... npx tsx scripts/backfill-type-configs.ts
 */

import fs from "fs";
import path from "path";
import { backfillEmptyTypeConfigs } from "../lib/db";

function loadEnvLocal() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return;
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const updated = await backfillEmptyTypeConfigs();
  console.log(`Backfill completado: ${updated} tipo(s) actualizado(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
