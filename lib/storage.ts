import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");

export function getDataDir(): string {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

export function getKnowledgeDir(evaluationTypeId: number): string {
  const dir = path.join(getDataDir(), String(evaluationTypeId), "knowledge");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getRubricPath(evaluationTypeId: number, filename: string): string {
  const dir = path.join(getDataDir(), String(evaluationTypeId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `rubric_${path.basename(filename)}`);
}

export function getRubricFilePath(evaluationTypeId: number, rubricPathFromConfig: string): string {
  if (!rubricPathFromConfig) return "";
  const dir = path.join(getDataDir(), String(evaluationTypeId));
  return path.join(dir, path.basename(rubricPathFromConfig));
}

export function getSessionDir(sessionId: string): string {
  const dir = path.join(getDataDir(), "sessions", sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function listKnowledgeFiles(evaluationTypeId: number): string[] {
  const dir = getKnowledgeDir(evaluationTypeId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
}

export function getKnowledgeFilePath(evaluationTypeId: number, filename: string): string {
  return path.join(getKnowledgeDir(evaluationTypeId), path.basename(filename));
}

export function getVectorsDir(evaluationTypeId: number): string {
  const dir = path.join(getDataDir(), String(evaluationTypeId), "vectors");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Índice RAG de archivos del proyecto (por sesión, separado del Knowledge). */
export function getProjectVectorsDir(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
  const dir = path.join(getSessionDir(safe), "vectors");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function readFileContent(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8");
}

export function readFileBuffer(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}
