import { NextResponse } from "next/server";
import { retryExtractElement } from "@/lib/project-extract-pipeline";

export const maxDuration = 90;

/** Reintento interactivo de extracción para un elemento concreto (casos difíciles / chat). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const evaluationTypeId = Number(body?.evaluationTypeId);
    const elementTitle = typeof body?.elementTitle === "string" ? body.elementTitle.trim() : "";
    const projectFilePaths = Array.isArray(body?.projectFilePaths)
      ? (body.projectFilePaths as string[]).filter((p) => typeof p === "string")
      : [];
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "default";

    if (!Number.isInteger(evaluationTypeId) || evaluationTypeId < 1) {
      return NextResponse.json({ error: "evaluationTypeId required" }, { status: 400 });
    }
    if (!elementTitle) {
      return NextResponse.json({ error: "elementTitle required" }, { status: 400 });
    }
    if (projectFilePaths.length === 0) {
      return NextResponse.json({ error: "projectFilePaths required" }, { status: 400 });
    }

    const result = await retryExtractElement({
      sessionId,
      evaluationTypeId,
      projectFilePaths,
      elementTitle,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
