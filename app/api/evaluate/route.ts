import { NextResponse } from "next/server";
import { buildSystemContext } from "@/lib/build-context";
import { streamChat } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

const EVALUATE_USER_PROMPT = `
Genera el informe de evaluación completo según las instrucciones y la rúbrica proporcionadas.
Incluye todas las secciones indicadas: notas por criterio, índices si aplican, y justificación.
Genera cada sección UNA SOLA VEZ; no repitas párrafos ni bloques de texto.
No uses nunca las etiquetas <think> ni </think>; responde únicamente con el contenido del informe, sin introducciones ni comentarios previos.
`.trim();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const evaluationTypeId = Number(body?.evaluationTypeId);
    const projectFilePaths = Array.isArray(body?.projectFilePaths)
      ? (body.projectFilePaths as string[]).filter((p: unknown) => typeof p === "string")
      : [];
    const projectElementsTable = Array.isArray(body?.projectElementsTable)
      ? (body.projectElementsTable as { element?: string; content?: string }[]).filter(
          (r) => r && typeof r.element === "string"
        ).map((r) => ({ element: r.element!, content: typeof r.content === "string" ? r.content : "" }))
      : undefined;

    if (!Number.isInteger(evaluationTypeId) || evaluationTypeId < 1) {
      return NextResponse.json({ error: "evaluationTypeId required" }, { status: 400 });
    }

    const systemContent = await buildSystemContext(evaluationTypeId, projectFilePaths, {
      projectElementsTable: projectElementsTable?.length ? projectElementsTable : undefined,
    });
    const noThink =
      "Responde solo con el informe. No uses etiquetas <think> ni </think> en tu respuesta.\n\n";
    const systemMessage =
      noThink + (systemContent || "Eres un evaluador de proyectos. Genera un informe de evaluación con notas, criterios y justificación según la rúbrica.");

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemMessage },
      { role: "user", content: EVALUATE_USER_PROMPT },
    ];

    const stream = streamChat(messages);

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`[Error: ${errMsg}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
