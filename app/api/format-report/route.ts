import { NextResponse } from "next/server";
import { getConfig, getEvaluationTypeById } from "@/lib/db";
import {
  assembleFinalNivelesReport,
  assembleFinalPonderacionesReport,
} from "@/lib/assemble-final-report";
import { createFormatLlmSemaphore } from "@/lib/evaluate-concurrency";
import { countFormatLlmSections } from "@/lib/assemble-formatted-report";
import { assertLlmModelsConfigured } from "@/lib/llm-config-server";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import {
  enrichReportFormatWithLegacySections,
  isReportFormatValid,
  mergeReportFormatConfig,
} from "@/lib/report-format-config";
import {
  findMissingFinalReportParts,
  isFinalReportComplete,
} from "@/lib/report-completeness";
import { isRubricConfigValid, mergeRubricConfig } from "@/lib/rubric-config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reensambla el informe §6 a partir del borrador de evaluación (sin re-evaluar subdimensiones).
 */
export async function POST(request: Request) {
  try {
    await assertLlmModelsConfigured();
    const body = await request.json();
    const evaluationTypeId = Number(body?.evaluationTypeId);
    const rawEvaluation =
      typeof body?.rawEvaluation === "string" ? body.rawEvaluation.trim() : "";
    const projectElementsTable = Array.isArray(body?.projectElementsTable)
      ? (body.projectElementsTable as { element?: string; content?: string }[])
          .filter((r) => r && typeof r.element === "string")
          .map((r) => ({
            element: r.element!,
            content: typeof r.content === "string" ? r.content : "",
          }))
      : [];
    const subdimensionScores =
      body?.subdimensionScores && typeof body.subdimensionScores === "object"
        ? (body.subdimensionScores as Record<string, number | null>)
        : undefined;
    const overallScore =
      typeof body?.overallScore === "number" ? body.overallScore : undefined;

    if (!Number.isInteger(evaluationTypeId) || evaluationTypeId < 1) {
      return NextResponse.json({ error: "evaluationTypeId required" }, { status: 400 });
    }
    if (!rawEvaluation) {
      return NextResponse.json(
        { error: "raw_evaluation_required", message: "Falta el borrador de evaluación." },
        { status: 400 }
      );
    }

    const config = await getConfig(evaluationTypeId);
    const type = await getEvaluationTypeById(evaluationTypeId);
    if (!config || !type) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }

    const rubric = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"), type.name);
    const reportFormat = enrichReportFormatWithLegacySections(
      mergeReportFormatConfig(JSON.parse(config.report_format_config || "{}"), rubric),
      rubric,
      (config.report_format ?? "").trim()
    );
    const evaluation = await getEvaluationConfig(evaluationTypeId);

    if (!isRubricConfigValid(rubric) || !isReportFormatValid(reportFormat, rubric)) {
      return NextResponse.json(
        { error: "invalid_config", message: "Rúbrica o formato de informe incompletos." },
        { status: 400 }
      );
    }

    const llmSectionCount = countFormatLlmSections(rubric, reportFormat);
    const semaphore = createFormatLlmSemaphore(llmSectionCount);

    if (rubric.type === "ponderaciones") {
      const result = await assembleFinalPonderacionesReport({
        rubric,
        reportFormat,
        rawEvaluation,
        projectElementsTable,
        evaluation,
        subdimensionScores,
        overallScore,
        semaphore,
      });

      if (
        !isFinalReportComplete(result.finalReport, reportFormat, rubric, {
          indicatorLabel: evaluation.indicatorLabel,
        })
      ) {
        const missing = findMissingFinalReportParts(result.finalReport, reportFormat, rubric, {
          indicatorLabel: evaluation.indicatorLabel,
        });
        return NextResponse.json(
          {
            error: "incomplete_report",
            message: `Informe incompleto tras formateo. Faltan: ${missing.join(", ")}`,
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        reportContent: result.finalReport,
        evaluationSummary: result.evaluationSummary,
        subdimensionScores: result.subdimensionScores,
        overallScore: result.overallScore,
      });
    }

    const assignedLevel =
      typeof body?.assignedLevel === "number" ? body.assignedLevel : null;
    const levelTitle = typeof body?.levelTitle === "string" ? body.levelTitle : "";

    const result = await assembleFinalNivelesReport({
      rubric,
      reportFormat,
      rawEvaluation,
      projectElementsTable,
      evaluation,
      assignedLevel,
      levelTitle,
      semaphore,
    });

    if (
      !isFinalReportComplete(result.finalReport, reportFormat, rubric, {
        requireScoresSection: false,
      })
    ) {
      const missing = findMissingFinalReportParts(result.finalReport, reportFormat, rubric, {
        requireScoresSection: false,
      });
      return NextResponse.json(
        {
          error: "incomplete_report",
          message: `Informe incompleto tras formateo. Faltan: ${missing.join(", ")}`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      reportContent: result.finalReport,
      evaluationSummary: result.evaluationSummary,
      subdimensionScores: {},
      overallScore: null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
