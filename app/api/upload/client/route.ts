import path from "path";
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { canClientBlobUpload, useBlobStorage } from "@/lib/blob-storage";
import { getEvaluationTypeById } from "@/lib/db";
import { getSupportedExtensions } from "@/lib/document-parser";

export const maxDuration = 60;

const ALLOWED_EXT = new Set(getSupportedExtensions());
const KNOWLEDGE_CONTENT_TYPES = [
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

type ClientPayload = { kind?: string; evaluationTypeId?: number };

export async function POST(request: Request): Promise<NextResponse> {
  if (!useBlobStorage()) {
    return NextResponse.json({ error: "Blob storage no configurado" }, { status: 400 });
  }
  if (!canClientBlobUpload()) {
    return NextResponse.json(
      {
        error:
          "Falta BLOB_READ_WRITE_TOKEN. En Vercel: Storage → tu Blob store → Connect to Project, o añade la variable en Settings → Environment Variables y redeploy.",
      },
      { status: 503 }
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: ClientPayload = {};
        try {
          payload = JSON.parse(clientPayload ?? "{}") as ClientPayload;
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

        return {
          allowedContentTypes: KNOWLEDGE_CONTENT_TYPES,
          maximumSizeInBytes: 50 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: clientPayload,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
