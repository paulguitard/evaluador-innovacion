import { NextResponse } from "next/server";
import { runExtractPipeline } from "@/lib/project-extract-pipeline";

export const maxDuration = 120;

/** Extrae proyecto con pipeline mejorado: RAG por sesión, heurísticas Excel, extracción por elemento. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectFilePaths = Array.isArray(body?.projectFilePaths)
      ? (body.projectFilePaths as string[]).filter((p) => typeof p === "string")
      : [];
    const evaluationTypeId =
      typeof body?.evaluationTypeId === "number" ? body.evaluationTypeId : null;
    const streamRequested = body?.stream === true;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "default";
    const useAgent = body?.useAgent === true;

    if (projectFilePaths.length === 0) {
      return NextResponse.json({ text: "" });
    }

    if (streamRequested) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of runExtractPipeline({
              sessionId,
              projectFilePaths,
              evaluationTypeId,
              useAgent,
            })) {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            }
          } catch (err) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "error", error: String(err) }) + "\n")
            );
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    let text = "";
    let elementsTable: { section: string; element: string; content: string }[] | undefined;
    let structuredData: unknown;

    for await (const event of runExtractPipeline({
      sessionId,
      projectFilePaths,
      evaluationTypeId,
      useAgent,
    })) {
      if (event.type === "done") {
        text = event.text;
        elementsTable = event.elementsTable;
        structuredData = event.structuredData;
      } else if (event.type === "error") {
        return NextResponse.json({ error: event.error, text: "" }, { status: 500 });
      }
    }

    return NextResponse.json({
      text,
      structured: true,
      structuredData,
      elementsTable,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), text: "" }, { status: 500 });
  }
}
