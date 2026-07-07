import { NextResponse } from "next/server";
import type { ProjectStructuredData } from "@/lib/build-context";
import { runChatAgent } from "@/lib/agent-orchestrator";
import type { ChatStreamEvent } from "@/lib/agent-events";
import { formatProviderError } from "@/lib/openrouter";
import { assertLlmModelsConfigured } from "@/lib/llm-config-server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 2000;

function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: ChatStreamEvent
) {
  controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
}

export async function POST(request: Request) {
  try {
    await assertLlmModelsConfigured();
    const body = await request.json();
    const evaluationTypeId = Number(body?.evaluationTypeId);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "default";
    const projectFilePaths = Array.isArray(body?.projectFilePaths)
      ? (body.projectFilePaths as string[]).filter((p: unknown) => typeof p === "string")
      : [];
    const projectElementsTable = Array.isArray(body?.projectElementsTable)
      ? (body.projectElementsTable as { element?: string; content?: string }[]).filter(
          (r) => r && typeof r.element === "string"
        ).map((r) => ({ element: r.element!, content: typeof r.content === "string" ? r.content : "" }))
      : undefined;
    const projectStructuredData =
      body?.projectStructuredData &&
      Array.isArray((body.projectStructuredData as { files?: unknown }).files) &&
      (body.projectStructuredData as { files: unknown[] }).files.length > 0
        ? (body.projectStructuredData as ProjectStructuredData)
        : undefined;
    const historyRaw = Array.isArray(body?.messages)
      ? (body.messages as { role: string; content: string }[]).filter(
          (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
        )
      : [];
    const history = historyRaw
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
    const bulkEvaluationContext =
      typeof body?.bulkEvaluationContext === "string" ? body.bulkEvaluationContext.trim() : "";

    if (!Number.isInteger(evaluationTypeId) || evaluationTypeId < 1) {
      return NextResponse.json({ error: "evaluationTypeId required" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const precomputedKnowledgeChunks =
      Array.isArray(body?.precomputedKnowledgeChunks) &&
      body.precomputedKnowledgeChunks.length > 0
        ? body.precomputedKnowledgeChunks
        : undefined;
    const clientRagEnabled = body?.clientRagEnabled === true;

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of runChatAgent({
            evaluationTypeId,
            message,
            sessionId,
            projectFilePaths,
            projectElementsTable,
            projectStructuredData,
            bulkEvaluationContext: bulkEvaluationContext || undefined,
            history,
            precomputedKnowledgeChunks,
            clientRagEnabled,
          })) {
            emit(controller, encoder, event);
          }
        } catch (err) {
          const errMsg = formatProviderError(err);
          emit(controller, encoder, { type: "error", error: errMsg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
