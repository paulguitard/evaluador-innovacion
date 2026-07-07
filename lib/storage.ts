import path from "path";
import fs from "fs";
import os from "os";

/** Sesiones de proyecto y caché temporal en /tmp (no persistente). */
export function useEphemeralSessions(): boolean {
  return true;
}

function getSessionsBaseDir(): string {
  return path.join(os.tmpdir(), "evaluador-sessions");
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

export function getSessionDir(sessionId: string): string {
  const safe = safeSessionId(sessionId);
  const dir = path.join(getSessionsBaseDir(), safe);
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
