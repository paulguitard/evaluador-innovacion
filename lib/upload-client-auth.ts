import path from "path";
import { getEvaluationTypeById } from "@/lib/db";
import { getSupportedExtensions } from "@/lib/document-parser";

export const KNOWLEDGE_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/octet-stream",
];

const ALLOWED_EXT = new Set(getSupportedExtensions());

export type KnowledgeClientPayload = { kind?: string; evaluationTypeId?: number };

export async function validateKnowledgeUploadPath(
  pathname: string,
  clientPayload: string | null
): Promise<{ typeId: number; tokenPayload: string | null }> {
  let payload: KnowledgeClientPayload = {};
  try {
    payload = JSON.parse(clientPayload ?? "{}") as KnowledgeClientPayload;
  } catch {
    throw new Error("Payload de subida inválido");
  }

  if (payload.kind !== "knowledge" || !Number.isInteger(payload.evaluationTypeId)) {
    throw new Error("evaluationTypeId requerido para subir knowledge");
  }

  const typeId = payload.evaluationTypeId!;
  const type = await getEvaluationTypeById(typeId);
  if (!type) throw new Error("Tipo de evaluación no encontrado");

  const expectedPrefix = `knowledge/${typeId}/`;
  if (!pathname.startsWith(expectedPrefix)) {
    throw new Error("Ruta de subida inválida");
  }

  const ext = path.extname(pathname).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error("Tipo de archivo no permitido");
  }

  return { typeId, tokenPayload: clientPayload };
}
