#!/usr/bin/env npx tsx
/**
 * Migra pipeline_config + report_format_config → evaluation_config (JSONB).
 * Registra tipos que tenían instructions no vacías (se descartan).
 *
 * Uso:
 *   npx tsx scripts/migrate-evaluation-config.ts
 */

import fs from "fs";
import path from "path";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "../lib/database-url";
import { mergeRubricConfig } from "../lib/rubric-config";
import { mergeReportFormatConfig } from "../lib/report-format-config";
import {
  buildEvaluationConfigFromLegacy,
  isEvaluationConfigEmpty,
} from "../lib/evaluation-config";

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
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw) {
    console.error("DATABASE_URL o POSTGRES_URL requerido.");
    process.exit(1);
  }
  const sql = postgres(normalizeDatabaseUrl(raw), {
    ssl: "require",
    prepare: false,
    max: 3,
  });

  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS evaluation_config JSONB DEFAULT '{}'`;

  const rows = (await sql`
    SELECT c.evaluation_type_id, t.name,
           c.evaluation_config, c.pipeline_config, c.report_format_config, c.rag_config,
           c.rubric_config, c.instructions
    FROM evaluation_type_config c
    JOIN evaluation_types t ON t.id = c.evaluation_type_id
  `) as {
    evaluation_type_id: number;
    name: string;
    evaluation_config: unknown;
    pipeline_config: unknown;
    report_format_config: unknown;
    rag_config: unknown;
    rubric_config: unknown;
    instructions: string | null;
  }[];

  let updated = 0;
  let discardedInstructions = 0;

  for (const row of rows) {
    const hadInstructions = !!(row.instructions ?? "").trim();
    if (hadInstructions) {
      discardedInstructions++;
      console.log(
        `  ⚠ Tipo ${row.evaluation_type_id} (${row.name}): instructions descartadas (${(row.instructions ?? "").slice(0, 60)}…)`,
      );
    }

    if (!isEvaluationConfigEmpty(row.evaluation_config)) continue;

    const rubric = mergeRubricConfig(row.rubric_config, row.name);
    const reportFormat = mergeReportFormatConfig(row.report_format_config, rubric);
    const evaluationConfig = buildEvaluationConfigFromLegacy(
      {
        pipeline_config: row.pipeline_config,
        report_format_config: reportFormat,
        rag_config: row.rag_config,
      },
      row.name,
    );

    await sql`
      UPDATE evaluation_type_config
      SET evaluation_config = ${sql.json(evaluationConfig)}
      WHERE evaluation_type_id = ${row.evaluation_type_id}
    `;
    updated++;
    console.log(`  ✓ Tipo ${row.evaluation_type_id} (${row.name}): evaluation_config poblado`);
  }

  await sql`ALTER TABLE evaluation_type_config DROP COLUMN IF EXISTS instructions`;

  await sql.end();
  console.log(
    `Migración completada: ${updated} tipo(s) actualizado(s), ${discardedInstructions} con instructions descartadas.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
