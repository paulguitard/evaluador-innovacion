import path from "path";
import fs from "fs";
import os from "os";

const DATA_DIR = path.join(process.cwd(), "data");

/** Serverless (Vercel): sesiones de proyecto en /tmp, no persistentes. */
export function useEphemeralSessions(): boolean {
  return (
    !!process.env.VERCEL ||
    !!process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    !!process.env.BLOB_STORE_ID?.trim()
  );
}

export function getDataDir(): string {
  const base = useEphemeralSessions()
    ? path.join(os.tmpdir(), "evaluador-data")
    : DATA_DIR;
  if (!fs.existsSync(base)) {
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch {
      /* read-only FS en serverless */
    }
  }
  return base;
}

export function getKnowledgeDir(evaluationTypeId: number): string {
  const base = useEphemeralSessions()
    ? path.join(os.tmpdir(), "evaluador-data")
    : getDataDir();
  const dir = path.join(base, String(evaluationTypeId), "knowledge");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* read-only FS */
    }
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

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

export function getSessionDir(sessionId: string): string {
  const safe = safeSessionId(sessionId);
  const base = useEphemeralSessions()
    ? path.join(os.tmpdir(), "evaluador-sessions")
    : path.join(getDataDir(), "sessions");
  const dir = path.join(base, safe);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Elimina archivos de proyecto en la sesión (no toca subdirs como vectors/). */
export function clearSessionProjectFiles(
  sessionId: string,
  allowedExtensions: string[]
): void {
  const dir = getSessionDir(sessionId);
  const allowed = new Set(allowedExtensions.map((e) => e.toLowerCase()));
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (!fs.statSync(fp).isFile()) continue;
    if (allowed.has(path.extname(f).toLowerCase())) {
      fs.unlinkSync(fp);
    }
  }
}

/** Rutas absolutas de archivos de proyecto en la sesión (excluye subdirs como vectors/). */
export function listSessionProjectFilePaths(
  sessionId: string,
  allowedExtensions: string[]
): string[] {
  const dir = getSessionDir(sessionId);
  const allowed = new Set(allowedExtensions.map((e) => e.toLowerCase()));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => {
      const fp = path.join(dir, f);
      return fs.statSync(fp).isFile() && allowed.has(path.extname(f).toLowerCase());
    })
    .map((f) => path.join(dir, f));
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
  const base = useEphemeralSessions()
    ? path.join(os.tmpdir(), "evaluador-vectors")
    : getDataDir();
  const dir = path.join(base, String(evaluationTypeId), "vectors");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* read-only FS en serverless: la ruta sirve solo para comprobar si hay caché local */
    }
  }
  return dir;
}

/** Índice RAG de archivos del proyecto (por sesión, separado del Knowledge). */
export function getProjectVectorsDir(sessionId: string): string {
  const dir = path.join(getSessionDir(sessionId), "vectors");
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
