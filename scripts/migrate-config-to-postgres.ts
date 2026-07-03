#!/usr/bin/env npx tsx
/**
 * Migra evaluation_types y evaluation_type_config desde SQLite local a Postgres (Supabase).
 *
 * Uso:
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate-config-to-postgres.ts
 *
 * Requiere data/evaluador.db en el directorio del proyecto.
 */

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { initDbPostgres } from "../lib/db-postgres";
import postgres from "postgres";

const dbPath = path.join(process.cwd(), "data", "evaluador.db");

/** Carga .env.local si DATABASE_URL no está en el entorno (p. ej. Windows / PowerShell). */
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

function loadSqlite() {
  if (!fs.existsSync(dbPath)) {
    console.error(`No se encontró ${dbPath}`);
    process.exit(1);
  }
  return new DatabaseSync(dbPath);
}

type SqliteType = { id: number; name: string };
type SqliteConfig = {
  evaluation_type_id: number;
  prompt: string;
  knowledge_paths: string;
  rubric_path: string;
  elements: string;
  instructions: string;
  report_format: string;
  rubric_prompt: string;
};

async function main() {
  loadEnvLocal();
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.error("DATABASE_URL o POSTGRES_URL es obligatorio.");
    process.exit(1);
  }

  const sqlite = loadSqlite();
  const sql = postgres(url, { ssl: "require", prepare: false, max: 1 });

  await initDbPostgres();

  const existing = await sql`SELECT COUNT(*)::int AS n FROM evaluation_types`;
  const existingCount = Number(existing[0]?.n ?? 0);
  if (existingCount > 0) {
    console.warn(
      `Aviso: Supabase ya tiene ${existingCount} tipo(s). La migración AÑADIRÁ los de SQLite (no reemplaza).`
    );
    console.warn("Si creaste tipos de prueba en Vercel, bórralos en Supabase Table Editor antes de migrar.\n");
  }

  const types = sqlite
    .prepare("SELECT id, name FROM evaluation_types ORDER BY id")
    .all() as SqliteType[];

  if (types.length === 0) {
    console.log("SQLite sin tipos de evaluación. Nada que migrar.");
    await sql.end();
    return;
  }

  console.log(`Migrando ${types.length} tipo(s) de evaluación…`);

  for (const t of types) {
    const config = sqlite
      .prepare(
        `SELECT evaluation_type_id, prompt, knowledge_paths, rubric_path, elements,
                instructions, report_format, rubric_prompt
         FROM evaluation_type_config WHERE evaluation_type_id = ?`
      )
      .get(t.id) as SqliteConfig | undefined;

    const inserted = await sql`
      INSERT INTO evaluation_types (name) VALUES (${t.name}) RETURNING id
    `;
    const newId = Number(inserted[0].id);

    const knowledgePaths = (() => {
      try {
        return JSON.parse(config?.knowledge_paths || "[]");
      } catch {
        return [];
      }
    })();
    const elements = (() => {
      try {
        return JSON.parse(config?.elements || "[]");
      } catch {
        return [];
      }
    })();

    await sql`
      INSERT INTO evaluation_type_config (
        evaluation_type_id, prompt, knowledge_paths, rubric_path,
        elements, instructions, report_format, rubric_prompt
      ) VALUES (
        ${newId},
        ${config?.prompt ?? ""},
        ${sql.json(knowledgePaths)},
        ${config?.rubric_path ?? ""},
        ${sql.json(elements)},
        ${config?.instructions ?? ""},
        ${config?.report_format ?? ""},
        ${config?.rubric_prompt ?? ""}
      )
    `;

    console.log(`  · "${t.name}" (SQLite id ${t.id} → Postgres id ${newId})`);
    if (knowledgePaths.length > 0) {
      console.log(
        `    knowledge_paths: ${knowledgePaths.length} entrada(s) — re-sube los PDFs en producción`
      );
    }
  }

  await sql.end();
  console.log("Migración completada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
