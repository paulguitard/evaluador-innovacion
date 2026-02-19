import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import * as pg from "./db-postgres";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "evaluador.db");

function usePostgres(): boolean {
  return typeof process !== "undefined" && !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function getDb(): DatabaseSync {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return new DatabaseSync(dbPath);
}

function initDbSync() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS evaluation_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS evaluation_type_config (
      evaluation_type_id INTEGER PRIMARY KEY,
      prompt TEXT DEFAULT '',
      knowledge_paths TEXT DEFAULT '[]',
      rubric_path TEXT DEFAULT '',
      elements TEXT DEFAULT '[]',
      instructions TEXT DEFAULT '',
      report_format TEXT DEFAULT '',
      rubric_prompt TEXT DEFAULT '',
      FOREIGN KEY (evaluation_type_id) REFERENCES evaluation_types(id) ON DELETE CASCADE
    );
  `);
  // Migration: add new columns to existing tables (ignore if already present)
  const alterColumns = [
    "ALTER TABLE evaluation_type_config ADD COLUMN elements TEXT DEFAULT '[]'",
    "ALTER TABLE evaluation_type_config ADD COLUMN instructions TEXT DEFAULT ''",
    "ALTER TABLE evaluation_type_config ADD COLUMN report_format TEXT DEFAULT ''",
    "ALTER TABLE evaluation_type_config ADD COLUMN rubric_prompt TEXT DEFAULT ''",
  ];
  for (const sql of alterColumns) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  }
}

export type ConfigRow = {
  evaluation_type_id: number;
  prompt: string;
  knowledge_paths: string;
  rubric_path: string;
  elements: string;
  instructions: string;
  report_format: string;
  rubric_prompt: string;
};

export type EvaluationTypeRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

// --- Async API (use from API routes and server code) ---

export async function initDb(): Promise<void> {
  if (usePostgres()) {
    await pg.initDbPostgres();
  } else {
    initDbSync();
  }
}

export async function getEvaluationTypes(): Promise<EvaluationTypeRow[]> {
  if (usePostgres()) {
    return pg.getEvaluationTypesPostgres();
  }
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, created_at, updated_at FROM evaluation_types ORDER BY id")
    .all() as EvaluationTypeRow[];
  return rows;
}

export async function getEvaluationTypeById(id: number): Promise<EvaluationTypeRow | null> {
  if (usePostgres()) {
    return pg.getEvaluationTypeByIdPostgres(id);
  }
  const db = getDb();
  const row = db
    .prepare("SELECT id, name, created_at, updated_at FROM evaluation_types WHERE id = ?")
    .get(id) as EvaluationTypeRow | undefined;
  return row ?? null;
}

export async function createEvaluationType(name: string): Promise<number> {
  if (usePostgres()) {
    return pg.createEvaluationTypePostgres(name);
  }
  const db = getDb();
  const insert = db.prepare("INSERT INTO evaluation_types (name) VALUES (?)");
  const runResult = insert.run(name) as { lastInsertRowid: number };
  const id = Number(runResult.lastInsertRowid);
  db.prepare(
    "INSERT INTO evaluation_type_config (evaluation_type_id, prompt, elements, instructions, report_format, rubric_prompt) VALUES (?, '', '[]', '', '', '')"
  ).run(id);
  return id;
}

export async function updateEvaluationType(id: number, name: string): Promise<void> {
  if (usePostgres()) {
    await pg.updateEvaluationTypePostgres(id, name);
    return;
  }
  const db = getDb();
  db.prepare("UPDATE evaluation_types SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
}

export async function deleteEvaluationType(id: number): Promise<void> {
  if (usePostgres()) {
    await pg.deleteEvaluationTypePostgres(id);
    return;
  }
  const db = getDb();
  db.prepare("DELETE FROM evaluation_type_config WHERE evaluation_type_id = ?").run(id);
  db.prepare("DELETE FROM evaluation_types WHERE id = ?").run(id);
}

export async function getConfig(evaluationTypeId: number): Promise<ConfigRow | null> {
  if (usePostgres()) {
    return pg.getConfigPostgres(evaluationTypeId);
  }
  const db = getDb();
  const row = db
    .prepare(
      "SELECT evaluation_type_id, prompt, knowledge_paths, rubric_path, elements, instructions, report_format, rubric_prompt FROM evaluation_type_config WHERE evaluation_type_id = ?"
    )
    .get(evaluationTypeId) as ConfigRow | undefined;
  if (!row) return null;
  return {
    ...row,
    elements: (row as ConfigRow & { elements?: string }).elements ?? "[]",
    instructions: (row as ConfigRow & { instructions?: string }).instructions ?? "",
    report_format: (row as ConfigRow & { report_format?: string }).report_format ?? "",
    rubric_prompt: (row as ConfigRow & { rubric_prompt?: string }).rubric_prompt ?? "",
  };
}

export type ConfigUpdateData = {
  prompt?: string;
  knowledge_paths?: (string | { name: string; url: string })[];
  rubric_path?: string;
  elements?: string | { title: string; description: string }[];
  instructions?: string;
  report_format?: string;
  rubric_prompt?: string;
};

export async function updateConfig(evaluationTypeId: number, data: ConfigUpdateData): Promise<void> {
  if (usePostgres()) {
    await pg.updateConfigPostgres(evaluationTypeId, data);
    return;
  }
  const db = getDb();
  const current = db
    .prepare(
      "SELECT prompt, knowledge_paths, rubric_path, elements, instructions, report_format, rubric_prompt FROM evaluation_type_config WHERE evaluation_type_id = ?"
    )
    .get(evaluationTypeId) as ConfigRow | undefined;
  if (!current) return;
  const prompt = data.prompt !== undefined ? data.prompt : current.prompt;
  const knowledge_paths =
    data.knowledge_paths !== undefined ? JSON.stringify(data.knowledge_paths) : current.knowledge_paths;
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
  db
    .prepare(
      "UPDATE evaluation_type_config SET prompt = ?, knowledge_paths = ?, rubric_path = ?, elements = ?, instructions = ?, report_format = ?, rubric_prompt = ? WHERE evaluation_type_id = ?"
    )
    .run(prompt, knowledge_paths, rubric_path, elements, instructions, report_format, rubric_prompt, evaluationTypeId);
}

export { getDb };
