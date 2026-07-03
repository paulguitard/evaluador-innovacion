import { NextResponse } from "next/server";
import { getEvaluationTypeById } from "@/lib/db";
import { registerKnowledgeUploads, type KnowledgeEntry } from "@/lib/knowledge-upload";
import { useBlobStorage } from "@/lib/blob-storage";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    if (!useBlobStorage()) {
      return NextResponse.json({ error: "Blob storage no configurado" }, { status: 400 });
    }

    const body = (await request.json()) as {
      evaluationTypeId?: number;
      blobs?: KnowledgeEntry[];
      reindex?: boolean;
    };
    const evaluationTypeId = Number(body.evaluationTypeId);
    const blobs = body.blobs;

    if (!Number.isInteger(evaluationTypeId)) {
      return NextResponse.json({ error: "evaluationTypeId requerido" }, { status: 400 });
    }
    if (!Array.isArray(blobs) || blobs.length === 0) {
      return NextResponse.json({ error: "blobs requerido" }, { status: 400 });
    }
    for (const entry of blobs) {
      if (!entry?.name || !entry?.url) {
        return NextResponse.json({ error: "Cada blob debe tener name y url" }, { status: 400 });
      }
    }

    const type = await getEvaluationTypeById(evaluationTypeId);
    if (!type) {
      return NextResponse.json({ error: "Tipo de evaluación no encontrado" }, { status: 404 });
    }

    const result = await registerKnowledgeUploads(evaluationTypeId, blobs);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
