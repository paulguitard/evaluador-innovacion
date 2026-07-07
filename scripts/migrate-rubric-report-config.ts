#!/usr/bin/env npx tsx
/**
 * Migra rubric_prompt / report_format (texto) a rubric_config / report_format_config (JSONB).
 *
 * Uso:
 *   npx tsx scripts/migrate-rubric-report-config.ts
 */

import fs from "fs";
import path from "path";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "../lib/database-url";
import { mergeRubricConfig, parseRubricFromLegacyText } from "../lib/rubric-config";
import {
  mergeReportFormatConfig,
  parseReportFormatFromLegacyText,
} from "../lib/report-format-config";

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

function isEmptyJsonb(val: unknown): boolean {
  if (val == null) return true;
  if (typeof val === "string") {
    const t = val.trim();
    return t === "" || t === "{}";
  }
  if (typeof val === "object") return Object.keys(val as object).length === 0;
  return true;
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

  const rows = (await sql`
    SELECT c.evaluation_type_id, t.name,
           c.rubric_prompt, c.report_format,
           c.rubric_config, c.report_format_config
    FROM evaluation_type_config c
    JOIN evaluation_types t ON t.id = c.evaluation_type_id
  `) as {
    evaluation_type_id: number;
    name: string;
    rubric_prompt: string | null;
    report_format: string | null;
    rubric_config: unknown;
    report_format_config: unknown;
  }[];

  let updated = 0;
  for (const row of rows) {
    let rubric = mergeRubricConfig(row.rubric_config, row.name);
    let reportFormat = mergeReportFormatConfig(row.report_format_config, rubric);
    let changed = false;

    if (isEmptyJsonb(row.rubric_config)) {
      const parsed = parseRubricFromLegacyText(row.rubric_prompt ?? "");
      if (parsed) {
        rubric = parsed;
        changed = true;
      } else if (!(row.rubric_prompt ?? "").trim()) {
        rubric = mergeRubricConfig({}, row.name);
        changed = true;
      }
    }

    if (isEmptyJsonb(row.report_format_config)) {
      const parsed = parseReportFormatFromLegacyText(row.report_format ?? "", rubric);
      if (parsed) {
        reportFormat = parsed;
        changed = true;
      } else if (!(row.report_format ?? "").trim()) {
        reportFormat = mergeReportFormatConfig({}, rubric);
        changed = true;
      }
    }

    if (changed) {
      await sql`
        UPDATE evaluation_type_config
        SET rubric_config = ${sql.json(rubric)},
            report_format_config = ${sql.json(reportFormat)}
        WHERE evaluation_type_id = ${row.evaluation_type_id}
      `;
      updated++;
      console.log(`  ✓ Tipo ${row.evaluation_type_id} (${row.name}): rubric=${rubric.type}`);
    }
  }

  await sql.end();
  console.log(`Migración completada: ${updated} tipo(s) actualizado(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
