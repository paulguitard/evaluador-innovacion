import { neon } from "@neondatabase/serverless";
import type { ConfigUpdateData } from "./db";

let _sql: ReturnType<typeof neon> | null = null;
function getSql(): ReturnType<typeof neon> {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL or POSTGRES_URL is required when using Postgres");
    _sql = neon(url);
  }
  return _sql;
}

export type ConfigRowPostgres = {
  evaluation_type_id: number;
  prompt: string;
  knowledge_paths: string;
  rubric_path: string;
  elements: string;
  instructions: string;
  report_format: string;
  rubric_prompt: string;
};

export async function initDbPostgres(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS evaluation_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS evaluation_type_config (
      evaluation_type_id INTEGER PRIMARY KEY REFERENCES evaluation_types(id) ON DELETE CASCADE,
      prompt TEXT DEFAULT '',
      knowledge_paths JSONB DEFAULT '[]',
      rubric_path TEXT DEFAULT '',
      elements JSONB DEFAULT '[]',
      instructions TEXT DEFAULT '',
      report_format TEXT DEFAULT '',
      rubric_prompt TEXT DEFAULT ''
    )
  `;
  try {
    await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS elements JSONB DEFAULT '[]'`;
  } catch {}
  try {
    await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS instructions TEXT DEFAULT ''`;
  } catch {}
  try {
    await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS report_format TEXT DEFAULT ''`;
  } catch {}
  try {
    await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS rubric_prompt TEXT DEFAULT ''`;
  } catch {}
}

export type EvaluationTypeRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

export async function getEvaluationTypesPostgres(): Promise<EvaluationTypeRow[]> {
  const sql = getSql();
  const rows = await sql`SELECT id, name, created_at, updated_at FROM evaluation_types ORDER BY id`;
  return (rows as { id: unknown; name: string; created_at: Date; updated_at: Date }[]).map((r) => ({
    id: Number(r.id),
    name: r.name,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export async function getEvaluationTypeByIdPostgres(id: number): Promise<EvaluationTypeRow | null> {
  const sql = getSql();
  const rows = (await sql`SELECT id, name, created_at, updated_at FROM evaluation_types WHERE id = ${id}`) as {
    id: unknown;
    name: string;
    created_at: Date;
    updated_at: Date;
  }[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    name: r.name,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export async function createEvaluationTypePostgres(name: string): Promise<number> {
  const sql = getSql();
  const rows = (await sql`INSERT INTO evaluation_types (name) VALUES (${name}) RETURNING id`) as { id: unknown }[];
  const id = Number(rows[0].id);
  await sql`INSERT INTO evaluation_type_config (evaluation_type_id, prompt, elements, instructions, report_format, rubric_prompt) VALUES (${id}, '', '[]', '', '', '')`;
  return id;
}

export async function updateEvaluationTypePostgres(id: number, name: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE evaluation_types SET name = ${name}, updated_at = now() WHERE id = ${id}`;
}

export async function deleteEvaluationTypePostgres(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM evaluation_type_config WHERE evaluation_type_id = ${id}`;
  await sql`DELETE FROM evaluation_types WHERE id = ${id}`;
}

export async function getConfigPostgres(evaluationTypeId: number): Promise<ConfigRowPostgres | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT evaluation_type_id, prompt, knowledge_paths, rubric_path, elements, instructions, report_format, rubric_prompt
    FROM evaluation_type_config WHERE evaluation_type_id = ${evaluationTypeId}
  `) as {
    evaluation_type_id: number;
    prompt: string;
    knowledge_paths: unknown;
    rubric_path: string;
    elements?: unknown;
    instructions?: string;
    report_format?: string;
    rubric_prompt?: string;
  }[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    evaluation_type_id: r.evaluation_type_id,
    prompt: r.prompt ?? "",
    knowledge_paths: typeof r.knowledge_paths === "string" ? r.knowledge_paths : JSON.stringify(r.knowledge_paths ?? []),
    rubric_path: r.rubric_path ?? "",
    elements: typeof r.elements === "string" ? r.elements : JSON.stringify(r.elements ?? []),
    instructions: r.instructions ?? "",
    report_format: r.report_format ?? "",
    rubric_prompt: r.rubric_prompt ?? "",
  };
}

export async function updateConfigPostgres(evaluationTypeId: number, data: ConfigUpdateData): Promise<void> {
  const current = await getConfigPostgres(evaluationTypeId);
  if (!current) return;
  const sql = getSql();
  const prompt = data.prompt !== undefined ? data.prompt : current.prompt;
  const knowledge_paths: (string | { name: string; url: string })[] =
    data.knowledge_paths !== undefined ? data.knowledge_paths : JSON.parse(current.knowledge_paths || "[]");
  const rubric_path = data.rubric_path !== undefined ? data.rubric_path : current.rubric_path;
  const elements =
    data.elements !== undefined
      ? typeof data.elements === "string"
        ? data.elements
        : JSON.stringify(data.elements)
      : current.elements;
  const instructions = data.instructions !== undefined ? data.instructions : current.instructions;
  const report_format = data.report_format !== undefined ? data.report_format : current.report_format;
  const rubric_prompt = data.rubric_prompt !== undefined ? data.rubric_prompt : current.rubric_prompt;
  await sql`
    UPDATE evaluation_type_config
    SET prompt = ${prompt}, knowledge_paths = ${knowledge_paths}, rubric_path = ${rubric_path},
        elements = ${elements}, instructions = ${instructions}, report_format = ${report_format}, rubric_prompt = ${rubric_prompt}
    WHERE evaluation_type_id = ${evaluationTypeId}
  `;
}
