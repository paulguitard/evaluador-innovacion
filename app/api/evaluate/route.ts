import { NextResponse } from "next/server";
import { getConfig, getEvaluationTypeById } from "@/lib/db";
import { runEvaluatePipeline } from "@/lib/evaluate-pipeline";
import { runEvaluateLevelsPipeline } from "@/lib/evaluate-levels-pipeline";
import { assertLlmModelsConfigured } from "@/lib/llm-config-server";
import { isRubricConfigValid, mergeRubricConfig } from "@/lib/rubric-config";
import { mergeReportFormatConfig, isReportFormatValid } from "@/lib/report-format-config";
import type { RetrievedChunk } from "@/lib/chunk-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await assertLlmModelsConfigured();
    const body = await request.json();
    const evaluationTypeId = Number(body?.evaluationTypeId);
    const projectElementsTable = Array.isArray(body?.projectElementsTable)
      ? (body.projectElementsTable as { element?: string; content?: string }[]).filter(
          (r) => r && typeof r.element === "string"
        ).map((r) => ({ element: r.element!, content: typeof r.content === "string" ? r.content : "" }))
      : undefined;

    if (!Number.isInteger(evaluationTypeId) || evaluationTypeId < 1) {
      return NextResponse.json({ error: "evaluationTypeId required" }, { status: 400 });
    }
    if (!projectElementsTable || projectElementsTable.length === 0) {
      return NextResponse.json(
        {
          error: "no_project",
          message: "No hay proyecto extraído. Suba archivos del proyecto y espere a que termine la extracción antes de evaluar.",
        },
        { status: 400 }
      );
    }

    const config = await getConfig(evaluationTypeId);
    const type = await getEvaluationTypeById(evaluationTypeId);
    if (!config || !type) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }

    const rubric = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"), type.name);
    const reportFormat = mergeReportFormatConfig(
      JSON.parse(config.report_format_config || "{}"),
      rubric
    );

    if (!isRubricConfigValid(rubric)) {
      return NextResponse.json(
        {
          error: "no_rubric",
          message: "No hay rúbrica configurada. Configure la rúbrica en §4 antes de evaluar.",
        },
        { status: 400 }
      );
    }

    if (!isReportFormatValid(reportFormat, rubric)) {
      return NextResponse.json(
        {
          error: "no_report_format",
          message: "Formato de informe incompleto. Revise la estructura en §6.",
        },
        { status: 400 }
      );
    }


    const precomputedSubdimensionChunks =
      body?.precomputedSubdimensionChunks &&
      typeof body.precomputedSubdimensionChunks === "object" &&
      !Array.isArray(body.precomputedSubdimensionChunks)
        ? (body.precomputedSubdimensionChunks as Record<string, RetrievedChunk[]>)
        : undefined;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of
            rubric.type === "niveles"
              ? runEvaluateLevelsPipeline(evaluationTypeId, projectElementsTable, {
                  precomputedSubdimensionChunks,
                })
              : runEvaluatePipeline(evaluationTypeId, projectElementsTable, {
                  precomputedSubdimensionChunks,
                })) {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: errMsg }) + "\n"));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
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
