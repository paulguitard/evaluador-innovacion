import postgres from "postgres";
import { normalizeDatabaseUrl } from "./database-url";
import {
  defaultEvaluationTypeSettings,
  mergeEvaluationTypeSettings,
  parseElementDefConfig,
  type EvaluationTypeSettings,
} from "./evaluation-type-settings";
import { defaultChatAgentConfig, type ChatAgentConfig } from "./chat-agent-config";
import {
  defaultBulkEvaluationConfig,
  mergeBulkEvaluationConfig,
  type BulkEvaluationConfig,
} from "./bulk-evaluation-config";
import {
  emptyLlmParams,
  type LlmUseCaseParams,
} from "./llm-config-types";
import { mergeRubricConfig, type RubricConfig } from "./rubric-config";
import { mergeReportFormatConfig, type ReportFormatConfig } from "./report-format-config";
import {
  buildEvaluationConfigFromLegacy,
  isEvaluationConfigEmpty,
  mergeEvaluationConfig,
  type EvaluationConfig,
} from "./evaluation-config";

export type ConfigUpdateData = {
  knowledge_paths?: (string | { name: string; url: string })[];
  elements?: string | Record<string, unknown>[];
  report_format?: string;
  rubric_prompt?: string;
  rubric_config?: RubricConfig;
  report_format_config?: ReportFormatConfig;
  evaluation_config?: EvaluationConfig;
  pipeline_config?: EvaluationTypeSettings["pipeline"];
  rag_config?: EvaluationTypeSettings["rag"];
  extract_config?: EvaluationTypeSettings["extract"];
};

let _sql: ReturnType<typeof postgres> | null = null;
let _initPromise: Promise<void> | null = null;

function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!raw) {
      throw new Error(
        "DATABASE_URL o POSTGRES_URL es obligatorio. Configura la conexión a Supabase en .env.local (ver docs/DEPLOY.md)."
      );
    }
    const url = normalizeDatabaseUrl(raw);
    _sql = postgres(url, {
      ssl: "require",
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }
  return _sql;
}

/** Ejecuta migraciones una sola vez por proceso (evita timeouts en Supabase). */
export async function ensureDb(): Promise<void> {
  if (!_initPromise) {
    _initPromise = runMigrations().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  await _initPromise;
}

/** @deprecated Use ensureDb */
export async function initDbPostgres(): Promise<void> {
  await ensureDb();
}

async function runMigrations(): Promise<void> {
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
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS elements JSONB DEFAULT '[]'`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS instructions TEXT DEFAULT ''`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS report_format TEXT DEFAULT ''`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS rubric_prompt TEXT DEFAULT ''`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS pipeline_config JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS rag_config JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS extract_config JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS rubric_config JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS report_format_config JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE evaluation_type_config ADD COLUMN IF NOT EXISTS evaluation_config JSONB DEFAULT '{}'`;

  // Backfill evaluation_config desde pipeline/report/rag antes de quitar instructions
  const legacyRows = (await sql`
    SELECT c.evaluation_type_id, t.name,
           c.evaluation_config, c.pipeline_config, c.report_format_config, c.rag_config,
           c.rubric_config, c.instructions
    FROM evaluation_type_config c
    JOIN evaluation_types t ON t.id = c.evaluation_type_id
  `) as unknown as {
    evaluation_type_id: number;
    name: string;
    evaluation_config: unknown;
    pipeline_config: unknown;
    report_format_config: unknown;
    rag_config: unknown;
    rubric_config: unknown;
    instructions?: string | null;
  }[];

  for (const row of legacyRows) {
    if (!isEvaluationConfigEmpty(row.evaluation_config)) continue;
    const rubric = mergeRubricConfig(row.rubric_config, row.name);
    const reportFormat = mergeReportFormatConfig(row.report_format_config, rubric);
    const evaluationConfig = buildEvaluationConfigFromLegacy(
      {
        pipeline_config: row.pipeline_config,
        report_format_config: reportFormat,
        rag_config: row.rag_config,
      },
      row.name
    );
    await sql`
      UPDATE evaluation_type_config
      SET evaluation_config = ${sql.json(evaluationConfig)}
      WHERE evaluation_type_id = ${row.evaluation_type_id}
    `;
  }

  await sql`ALTER TABLE evaluation_type_config DROP COLUMN IF EXISTS instructions`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `;
}

export type ConfigRowPostgres = {
  evaluation_type_id: number;
  knowledge_paths: string;
  elements: string;
  report_format: string;
  rubric_prompt: string;
  rubric_config: string;
  report_format_config: string;
  evaluation_config: string;
  pipeline_config: string;
  rag_config: string;
  extract_config: string;
};

const LLM_MODELS_KEY = "llm_models";
const LLM_PARAMS_KEY = "llm_params";
const CHAT_AGENT_CONFIG_KEY = "chat_agent_config";
const BULK_EVALUATION_CONFIG_KEY = "bulk_evaluation_config";

function jsonCol(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? JSON.parse(fallback || "{}"));
}

export async function getLlmModelsPostgres(): Promise<Record<string, string> | null> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`
    SELECT value FROM app_settings WHERE key = ${LLM_MODELS_KEY}
  `) as unknown as { value: unknown }[];
  if (rows.length === 0) return null;
  const value = rows[0].value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function saveLlmModelsPostgres(models: Record<string, string>): Promise<void> {
  await ensureDb();
  const sql = getSql();
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${LLM_MODELS_KEY}, ${sql.json(models)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function getLlmParamsPostgres(): Promise<Record<string, LlmUseCaseParams> | null> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`
    SELECT value FROM app_settings WHERE key = ${LLM_PARAMS_KEY}
  `) as unknown as { value: unknown }[];
  if (rows.length === 0) return null;
  const value = rows[0].value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, LlmUseCaseParams>;
}

export async function saveLlmParamsPostgres(params: Record<string, LlmUseCaseParams>): Promise<void> {
  await ensureDb();
  const sql = getSql();
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${LLM_PARAMS_KEY}, ${sql.json(params)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function getChatAgentConfigPostgres(): Promise<ChatAgentConfig | null> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`
    SELECT value FROM app_settings WHERE key = ${CHAT_AGENT_CONFIG_KEY}
  `) as unknown as { value: unknown }[];
  if (rows.length === 0) return null;
  const value = rows[0].value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ChatAgentConfig;
}

export async function saveChatAgentConfigPostgres(config: ChatAgentConfig): Promise<void> {
  await ensureDb();
  const sql = getSql();
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${CHAT_AGENT_CONFIG_KEY}, ${sql.json(config)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function getBulkEvaluationConfigPostgres(): Promise<BulkEvaluationConfig | null> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`
    SELECT value FROM app_settings WHERE key = ${BULK_EVALUATION_CONFIG_KEY}
  `) as unknown as { value: unknown }[];
  if (rows.length === 0) return null;
  const value = rows[0].value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return mergeBulkEvaluationConfig(value as Partial<BulkEvaluationConfig>);
}

export async function saveBulkEvaluationConfigPostgres(config: BulkEvaluationConfig): Promise<void> {
  await ensureDb();
  const sql = getSql();
  const merged = mergeBulkEvaluationConfig(config);
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${BULK_EVALUATION_CONFIG_KEY}, ${sql.json(merged)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export type EvaluationTypeRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

export async function getEvaluationTypesPostgres(): Promise<EvaluationTypeRow[]> {
  await ensureDb();
  const sql = getSql();
  const rows = await sql`SELECT id, name, created_at, updated_at FROM evaluation_types ORDER BY id`;
  return (rows as unknown as { id: unknown; name: string; created_at: Date; updated_at: Date }[]).map((r) => ({
    id: Number(r.id),
    name: r.name,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export async function getEvaluationTypeByIdPostgres(id: number): Promise<EvaluationTypeRow | null> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`SELECT id, name, created_at, updated_at FROM evaluation_types WHERE id = ${id}`) as unknown as {
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
  await ensureDb();
  const sql = getSql();
  const typeName = name.trim() || "IGIP";
  const defaults = defaultEvaluationTypeSettings(typeName);
  const rubric = mergeRubricConfig({}, typeName);
  const reportFormat = mergeReportFormatConfig({}, rubric);
  const evaluationConfig = mergeEvaluationConfig(
    {
      pipeline_config: defaults.pipeline,
      report_format_config: reportFormat,
      rag_config: defaults.rag,
    },
    typeName
  );
  const rows = (await sql`INSERT INTO evaluation_types (name) VALUES (${name}) RETURNING id`) as unknown as {
    id: unknown;
  }[];
  const id = Number(rows[0].id);
  await sql`
    INSERT INTO evaluation_type_config (
      evaluation_type_id, elements, report_format, rubric_prompt,
      rubric_config, report_format_config, evaluation_config,
      pipeline_config, rag_config, extract_config
    ) VALUES (
      ${id}, '[]', '', '',
      ${sql.json(rubric)},
      ${sql.json(reportFormat)},
      ${sql.json(evaluationConfig)},
      ${sql.json(defaults.pipeline)},
      ${sql.json(defaults.rag)},
      ${sql.json(defaults.extract)}
    )
  `;
  return id;
}

export async function updateEvaluationTypePostgres(id: number, name: string): Promise<void> {
  await ensureDb();
  const sql = getSql();
  await sql`UPDATE evaluation_types SET name = ${name}, updated_at = now() WHERE id = ${id}`;
}

export async function deleteEvaluationTypePostgres(id: number): Promise<void> {
  await ensureDb();
  const sql = getSql();
  await sql`DELETE FROM evaluation_type_config WHERE evaluation_type_id = ${id}`;
  await sql`DELETE FROM evaluation_types WHERE id = ${id}`;
}

export async function getConfigPostgres(evaluationTypeId: number): Promise<ConfigRowPostgres | null> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`
    SELECT evaluation_type_id, knowledge_paths, elements, report_format, rubric_prompt,
           rubric_config, report_format_config, evaluation_config,
           pipeline_config, rag_config, extract_config
    FROM evaluation_type_config WHERE evaluation_type_id = ${evaluationTypeId}
  `) as unknown as {
    evaluation_type_id: number;
    knowledge_paths: unknown;
    elements?: unknown;
    report_format?: string;
    rubric_prompt?: string;
    rubric_config?: unknown;
    report_format_config?: unknown;
    evaluation_config?: unknown;
    pipeline_config?: unknown;
    rag_config?: unknown;
    extract_config?: unknown;
  }[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    evaluation_type_id: r.evaluation_type_id,
    knowledge_paths:
      typeof r.knowledge_paths === "string" ? r.knowledge_paths : JSON.stringify(r.knowledge_paths ?? []),
    elements: typeof r.elements === "string" ? r.elements : JSON.stringify(r.elements ?? []),
    report_format: r.report_format ?? "",
    rubric_prompt: r.rubric_prompt ?? "",
    rubric_config: jsonCol(r.rubric_config, "{}"),
    report_format_config: jsonCol(r.report_format_config, "{}"),
    evaluation_config: jsonCol(r.evaluation_config, "{}"),
    pipeline_config: jsonCol(r.pipeline_config, "{}"),
    rag_config: jsonCol(r.rag_config, "{}"),
    extract_config: jsonCol(r.extract_config, "{}"),
  };
}

export async function updateConfigPostgres(evaluationTypeId: number, data: ConfigUpdateData): Promise<void> {
  await ensureDb();
  const current = await getConfigPostgres(evaluationTypeId);
  if (!current) return;
  const typeRow = await getEvaluationTypeByIdPostgres(evaluationTypeId);
  const typeName = typeRow?.name ?? "IGIP";
  const sql = getSql();
  const knowledge_paths: (string | { name: string; url: string })[] =
    data.knowledge_paths !== undefined ? data.knowledge_paths : JSON.parse(current.knowledge_paths || "[]");
  const rawElements =
    data.elements !== undefined
      ? typeof data.elements === "string"
        ? JSON.parse(data.elements)
        : data.elements
      : JSON.parse(current.elements || "[]");
  const elementsJson = Array.isArray(rawElements)
    ? rawElements
        .map((e) => parseElementDefConfig(e))
        .filter((e): e is NonNullable<typeof e> => e != null)
    : [];
  const report_format = data.report_format !== undefined ? data.report_format : current.report_format;
  const rubric_prompt = data.rubric_prompt !== undefined ? data.rubric_prompt : current.rubric_prompt;
  const rawRubric =
    data.rubric_config !== undefined
      ? data.rubric_config
      : JSON.parse(current.rubric_config || "{}");
  const mergedRubric = mergeRubricConfig(rawRubric, typeName);
  const rawReportFormat =
    data.report_format_config !== undefined
      ? data.report_format_config
      : JSON.parse(current.report_format_config || "{}");
  const mergedReportFormat = mergeReportFormatConfig(rawReportFormat, mergedRubric);
  const rawPipeline =
    data.pipeline_config !== undefined
      ? data.pipeline_config
      : JSON.parse(current.pipeline_config || "{}");
  const rawRag =
    data.rag_config !== undefined ? data.rag_config : JSON.parse(current.rag_config || "{}");
  const rawExtract =
    data.extract_config !== undefined ? data.extract_config : JSON.parse(current.extract_config || "{}");
  const merged = mergeEvaluationTypeSettings(
    {
      pipeline_config: rawPipeline,
      rag_config: rawRag,
      extract_config: rawExtract,
    },
    typeName
  );

  const rawEvaluation =
    data.evaluation_config !== undefined
      ? data.evaluation_config
      : JSON.parse(current.evaluation_config || "{}");
  const mergedEvaluation = mergeEvaluationConfig(
    {
      evaluation_config: rawEvaluation,
      pipeline_config: merged.pipeline,
      report_format_config: mergedReportFormat,
      rag_config: merged.rag,
    },
    typeName
  );

  await sql`
    UPDATE evaluation_type_config
    SET knowledge_paths = ${sql.json(knowledge_paths)},
        elements = ${sql.json(elementsJson)},
        report_format = ${report_format},
        rubric_prompt = ${rubric_prompt},
        rubric_config = ${sql.json(mergedRubric)},
        report_format_config = ${sql.json(mergedReportFormat)},
        evaluation_config = ${sql.json(mergedEvaluation)},
        pipeline_config = ${sql.json(merged.pipeline)},
        rag_config = ${sql.json(merged.rag)},
        extract_config = ${sql.json(merged.extract)}
    WHERE evaluation_type_id = ${evaluationTypeId}
  `;
}

/** Backfill JSONB configs vacíos con defaults según nombre del tipo. */
export async function backfillEmptyTypeConfigsPostgres(): Promise<number> {
  await ensureDb();
  const sql = getSql();
  const rows = (await sql`
    SELECT c.evaluation_type_id, t.name, c.pipeline_config, c.rag_config, c.extract_config
    FROM evaluation_type_config c
    JOIN evaluation_types t ON t.id = c.evaluation_type_id
  `) as unknown as {
    evaluation_type_id: number;
    name: string;
    pipeline_config: unknown;
    rag_config: unknown;
    extract_config: unknown;
  }[];
  let updated = 0;
  for (const row of rows) {
    const emptyPipeline =
      !row.pipeline_config ||
      (typeof row.pipeline_config === "object" &&
        Object.keys(row.pipeline_config as object).length === 0);
    if (!emptyPipeline) continue;
    const defaults = defaultEvaluationTypeSettings(row.name);
    await sql`
      UPDATE evaluation_type_config
      SET pipeline_config = ${sql.json(defaults.pipeline)},
          rag_config = ${sql.json(defaults.rag)},
          extract_config = ${sql.json(defaults.extract)}
      WHERE evaluation_type_id = ${row.evaluation_type_id}
    `;
    updated++;
  }
  return updated;
}
