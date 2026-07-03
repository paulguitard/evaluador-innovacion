#!/usr/bin/env npx tsx
/**
 * Asigna un documento ya subido a Vercel Blob a un tipo de evaluación y reindexa RAG.
 *
 * Uso:
 *   npx tsx scripts/assign-blob-knowledge.ts --type IGIP --name "Manual OSLO.pdf" --url "https://....blob.vercel-storage.com/..."
 */

import fs from "fs";
import path from "path";
import postgres from "postgres";
import { initDbPostgres, getEvaluationTypesPostgres } from "../lib/db-postgres";
import { normalizeDatabaseUrl } from "../lib/database-url";

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

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i]?.startsWith("--") && args[i + 1]) {
      out[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  loadEnvLocal();
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw) {
    console.error("DATABASE_URL requerido (.env.local o entorno).");
    process.exit(1);
  }
  process.env.DATABASE_URL = normalizeDatabaseUrl(raw);

  const { type, name, url } = parseArgs();
  if (!type?.trim() || !name?.trim() || !url?.trim()) {
    console.error(
      'Uso: npx tsx scripts/assign-blob-knowledge.ts --type IGIP --name "Manual OSLO.pdf" --url "https://....blob.vercel-storage.com/..."'
    );
    process.exit(1);
  }

  await initDbPostgres();
  const sql = postgres(normalizeDatabaseUrl(raw), { ssl: "require", prepare: false, max: 1 });
  const types = await getEvaluationTypesPostgres();
  const match = types.find((t) => t.name.toLowerCase() === type.trim().toLowerCase());
  if (!match) {
    console.error(`Tipo "${type}" no encontrado. Disponibles: ${types.map((t) => t.name).join(", ") || "(ninguno)"}`);
    process.exit(1);
  }

  const entry = { name: name.trim(), url: url.trim() };
  console.log(`Verificando URL del blob…`);
  const res = await fetch(entry.url, { method: "HEAD" });
  if (!res.ok) {
    const getRes = await fetch(entry.url);
    if (!getRes.ok) {
      console.error(`No se pudo acceder al blob (${res.status}). Revisa la URL.`);
      process.exit(1);
    }
  }

  await sql`
    UPDATE evaluation_type_config
    SET knowledge_paths = ${sql.json([entry])}
    WHERE evaluation_type_id = ${match.id}
  `;
  await sql.end();
  console.log(`Asignado a "${match.name}" (id ${match.id}): ${entry.name}`);
  console.log(`\nPulsa "Reindexar RAG" en Configuración → ${match.name}, o llama POST /api/config/${match.id}/reindex`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
