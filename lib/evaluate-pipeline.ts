import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { streamChat } from "@/lib/openrouter";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import { getGlobalLlmSemaphore, type EvaluateLlmSemaphore } from "@/lib/evaluate-concurrency";
import {
  logEvaluateSubdimSummary,
  recordEvaluateSubdimAttempt,
} from "@/lib/evaluate-subdim-telemetry";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import { sanitizeLlmEvaluationText } from "@/lib/llm-output-sanitize";
import {
  assembleFinalPonderacionesReportEvents,
  type AssembleFinalReportResult,
} from "@/lib/assemble-final-report";
import {
  enrichReportFormatWithLegacySections,
  isReportFormatValid,
  mergeReportFormatConfig,
  type ReportFormatConfig,
} from "@/lib/report-format-config";
import {
  getRawSubdimensionAnalysisIssues,
  isRawSubdimensionAnalysisComplete,
} from "@/lib/report-completeness";
import {
  parseSubdimensionScore,
  subdimensionScoreKey,
  buildEvaluationScoresPayload,
} from "@/lib/evaluation-scores";
import {
  isRubricConfigValid,
  mergeRubricConfig,
  buildRubricScoreSchemaFromConfig,
  subdimensionEvalContent,
  type RubricConfigPonderaciones,
} from "@/lib/rubric-config";
import {
  type RubricDimension,
  type RubricSubdimension,
} from "@/lib/rubric-dimensions";
import { buildSubdimensionKnowledgeQuery } from "@/lib/evaluate-rag-query";
import type { RetrievedChunk } from "@/lib/chunk-types";
import {
  applyPromptTemplate,
  DEFAULT_SUBDIMENSION_USER_PROMPT,
  formatOptionalPhaseInstructions,
} from "@/lib/eval-types/prompt-defaults";
import { resolveEvaluateSystemContextWithRetry } from "@/lib/resolve-evaluate-system-context";
import {
  buildMissingNotaRecoveryPrompt,
  buildSubdimensionRetryPrompt,
  MAX_SUBDIM_QUALITY_RETRIES,
} from "@/lib/subdimension-retry-prompt";
import {
  EvaluateSystemContextError,
  validateProjectElementsForEvaluation,
} from "@/lib/evaluate-system-context-strict";

export type EvaluateStreamEvent =
  | { type: "step"; message: string }
  | { type: "dimension"; name: string; index: number; total: number }
  | {
      type: "subdimension";
      dimension: string;
      name: string;
      index: number;
      total: number;
    }
  | {
      type: "subdimension_score";
      dimension: string;
      name: string;
      score: number | null;
    }
  | {
      type: "scores_summary";
      subdimensionScores: Record<string, number | null>;
      overallScore: number | null;
    }
  | {
      type: "evaluation_scores";
      payload: import("@/lib/evaluation-scores").EvaluationScoresPayload;
    }
  | { type: "evaluation_summary"; text: string }
  | { type: "assigned_level"; level: number | null; title: string }
  | {
      type: "variable_level";
      name: string;
      level: number | null;
      index: number;
      total: number;
    }
  | { type: "report_draft"; content: string }
  | { type: "report_content"; content: string }
  | { type: "formatting"; message: string }
  | { type: "content"; chunk: string }
  | { type: "done" }
  | { type: "error"; error: string };

function subdimensionUserPrompt(
  dimension: RubricDimension,
  subdimension: RubricSubdimension,
  scoreScale: { min: number; max: number },
  evaluation: EvaluationConfig,
  phaseInstructions: string
): string {
  const label = evaluation.knowledgeReferenceLabel;
  const scoreExamples = Array.from(
    { length: scoreScale.max - scoreScale.min + 1 },
    (_, i) => scoreScale.min + i
  ).join(", ");
  const phaseBlock = formatOptionalPhaseInstructions(phaseInstructions);
  const template =
    evaluation.prompts.subdimensionUser?.trim() || DEFAULT_SUBDIMENSION_USER_PROMPT;
  return applyPromptTemplate(template, {
    dimension: dimension.name,
    subdimension: subdimension.name,
    scoreExamples,
    knowledgeLabel: label,
    phaseInstructions: phaseBlock,
  });
}

async function collectStream(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens: number,
  semaphore?: EvaluateLlmSemaphore
): Promise<string> {
  const run = async () => {
    let out = "";
    for await (const chunk of streamChat(messages, { max_tokens: maxTokens, useCase: "evaluate" })) {
      out += chunk;
    }
    return sanitizeLlmEvaluationText(out);
  };
  return semaphore ? semaphore.run(run) : run();
}

type RagLlmPassParams = {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  ragQuery: string;
  evaluateSubdimension?: { dimensionName: string; name: string; content: string };
  userPrompt: string;
  maxTokens: number;
  knowledgeLabel: string;
  semaphore: EvaluateLlmSemaphore;
  precomputedKnowledgeChunks?: RetrievedChunk[];
  subdimensionLabel: string;
};

async function runRagLlmPass(params: RagLlmPassParams): Promise<string> {
  return params.semaphore.run(async () => {
    validateProjectElementsForEvaluation(params.projectElementsTable);

    const systemMessage = await resolveEvaluateSystemContextWithRetry({
      evaluationTypeId: params.evaluationTypeId,
      projectElementsTable: params.projectElementsTable,
      ragQuery: params.ragQuery,
      evaluateSubdimension: params.evaluateSubdimension,
      precomputedKnowledgeChunks: params.precomputedKnowledgeChunks,
      subdimensionLabel: params.subdimensionLabel,
    });

    return collectStream(
      [
        { role: "system", content: systemMessage },
        { role: "user", content: params.userPrompt },
      ],
      params.maxTokens
    );
  });
}

type SubdimResult = {
  j: number;
  sub: RubricSubdimension;
  subAnalysis: string;
  parsedScore: number | null;
};

type DimensionEvalContext = {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  rubric: RubricConfigPonderaciones;
  reportFormat: ReportFormatConfig;
  evaluation: EvaluationConfig;
  scoreScale: { min: number; max: number };
  topN: number;
  phase: EvaluationConfig["phaseInstructions"];
  totalDimensions: number;
  semaphore: EvaluateLlmSemaphore;
  precomputedSubdimensionChunks?: Record<string, RetrievedChunk[]>;
};

type DimensionEvalResult = {
  index: number;
  dimText: string;
  subdimensionScores: Record<string, number | null>;
  events: EvaluateStreamEvent[];
};

async function evaluateSingleDimension(
  index: number,
  dimConfig: RubricConfigPonderaciones["dimensions"][0],
  ctx: DimensionEvalContext,
  onEvent?: (event: EvaluateStreamEvent) => void
): Promise<DimensionEvalResult> {
  const events: EvaluateStreamEvent[] = [];
  const emit = (event: EvaluateStreamEvent) => {
    events.push(event);
    onEvent?.(event);
  };

  const dim: RubricDimension = {
    name: dimConfig.name,
    content: dimConfig.subdimensions
      .map((s) => subdimensionEvalContent(dimConfig, s))
      .join("\n\n"),
  };
  const subdims: RubricSubdimension[] = dimConfig.subdimensions.map((s) => ({
    name: s.name,
    content: subdimensionEvalContent(dimConfig, s),
  }));

  if (subdims.length > 0) {
    emit({
      type: "step",
      message: `Evaluando ${subdims.length} subdimensión(es) de ${dim.name} (${ctx.evaluation.parallelSubdimensions ? "en paralelo" : "secuencial"})…`,
    });
  }

  const runSubdim = async (
    sub: RubricSubdimension,
    j: number,
    subConfig: RubricConfigPonderaciones["dimensions"][0]["subdimensions"][0]
  ): Promise<SubdimResult> => {
    const subQuery = buildSubdimensionKnowledgeQuery(dim, sub, ctx.projectElementsTable, ctx.topN);
    const scoreKey = subdimensionScoreKey(dim.name, sub.name);
    const userPrompt = subdimensionUserPrompt(
      dim,
      sub,
      ctx.scoreScale,
      ctx.evaluation,
      ctx.phase.subdimensionEval
    );
    const passParams = {
      evaluationTypeId: ctx.evaluationTypeId,
      projectElementsTable: ctx.projectElementsTable,
      ragQuery: subQuery,
      evaluateSubdimension: {
        dimensionName: dim.name,
        name: sub.name,
        content: sub.content,
      },
      userPrompt,
      maxTokens: ctx.evaluation.maxTokens.subdimension,
      knowledgeLabel: ctx.evaluation.knowledgeReferenceLabel,
      semaphore: ctx.semaphore,
      precomputedKnowledgeChunks: ctx.precomputedSubdimensionChunks?.[scoreKey],
      subdimensionLabel: `${sub.name} (${dim.name})`,
    };

    let subAnalysis: string;
    try {
      subAnalysis = await runRagLlmPass(passParams);
    } catch (err) {
      const msg =
        err instanceof EvaluateSystemContextError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Error(`No se pudo evaluar la subdimensión «${sub.name}»: ${msg}`);
    }

    let qualityAttempt = 0;
    while (
      !isRawSubdimensionAnalysisComplete(subAnalysis) &&
      qualityAttempt < MAX_SUBDIM_QUALITY_RETRIES
    ) {
      const issues = getRawSubdimensionAnalysisIssues(subAnalysis);
      recordEvaluateSubdimAttempt({
        dimension: dim.name,
        subdimension: sub.name,
        attempt: qualityAttempt,
        acceptable: false,
        issues,
        chars: subAnalysis.length,
      });
      emit({
        type: "step",
        message: `Reintentando evaluación incompleta de «${sub.name}» (${issues.join(", ")})…`,
      });
      const retryPrompt = buildSubdimensionRetryPrompt(userPrompt, issues);
      subAnalysis = await runRagLlmPass({ ...passParams, userPrompt: retryPrompt });
      qualityAttempt++;
    }

    if (!isRawSubdimensionAnalysisComplete(subAnalysis)) {
      const preRecoveryIssues = getRawSubdimensionAnalysisIssues(subAnalysis);
      if (
        preRecoveryIssues.length === 1 &&
        preRecoveryIssues[0] === "missing_nota"
      ) {
        emit({
          type: "step",
          message: `Reintentando «${sub.name}»: falta línea «Nota: N»…`,
        });
        const recoveryPrompt = buildMissingNotaRecoveryPrompt(
          userPrompt,
          subAnalysis
        );
        subAnalysis = await runRagLlmPass({
          ...passParams,
          userPrompt: recoveryPrompt,
        });
      }
    }

    if (!isRawSubdimensionAnalysisComplete(subAnalysis)) {
      const issues = getRawSubdimensionAnalysisIssues(subAnalysis);
      recordEvaluateSubdimAttempt({
        dimension: dim.name,
        subdimension: sub.name,
        attempt: qualityAttempt,
        acceptable: false,
        issues,
        chars: subAnalysis.length,
      });
      logEvaluateSubdimSummary(dim.name, sub.name, "failed", issues);
      throw new Error(
        `Evaluación incompleta de la subdimensión «${sub.name}» (${dim.name}): ${issues.join(", ")}. Reintente la evaluación.`
      );
    }

    logEvaluateSubdimSummary(dim.name, sub.name, "ok");

    const parsedScore = parseSubdimensionScore(subAnalysis);
    // Emitir nota apenas se parsea el JSON/texto de la subdimensión (antes del informe final).
    emit({
      type: "subdimension_score",
      dimension: dim.name,
      name: sub.name,
      score: parsedScore,
    });
    emit({
      type: "subdimension",
      dimension: dim.name,
      name: sub.name,
      index: j + 1,
      total: subdims.length,
    });

    return {
      j,
      sub,
      subAnalysis,
      parsedScore,
    };
  };

  const subdimResults = ctx.evaluation.parallelSubdimensions
    ? await Promise.all(
        subdims.map((sub, j) => runSubdim(sub, j, dimConfig.subdimensions[j]))
      )
    : await (async () => {
        const out: SubdimResult[] = [];
        for (let j = 0; j < subdims.length; j++) {
          out.push(await runSubdim(subdims[j], j, dimConfig.subdimensions[j]));
        }
        return out;
      })();

  subdimResults.sort((a, b) => a.j - b.j);

  const subdimensionScores: Record<string, number | null> = {};

  for (const result of subdimResults) {
    const scoreKey = subdimensionScoreKey(dim.name, result.sub.name);
    subdimensionScores[scoreKey] = result.parsedScore;
  }

  const dimSections: string[] = [
    `## Dimensión: ${dim.name}`,
    ...subdimResults.map(
      (result) => `### Subdimensión: ${result.sub.name}\n\n${result.subAnalysis.trim()}`
    ),
  ];

  emit({
    type: "dimension",
    name: dim.name,
    index: index + 1,
    total: ctx.totalDimensions,
  });

  return {
    index,
    dimText: dimSections.join("\n\n"),
    subdimensionScores,
    events,
  };
}

/** Evaluación por ponderaciones: RAG+LLM por subdimensión; resumen macro en formateo §6. */
export async function* runEvaluatePipeline(
  evaluationTypeId: number,
  projectElementsTable: { element: string; content: string }[],
  options?: { precomputedSubdimensionChunks?: Record<string, RetrievedChunk[]> }
): AsyncGenerator<EvaluateStreamEvent, void, unknown> {
  const config = await getConfig(evaluationTypeId);
  if (!config) {
    yield { type: "error", error: "Configuración no encontrada" };
    return;
  }

  const typeRow = await getEvaluationTypeByIdPostgres(evaluationTypeId);
  const rubric = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"), typeRow?.name);
  const evaluation = await getEvaluationConfig(evaluationTypeId);
  const reportFormat = enrichReportFormatWithLegacySections(
    mergeReportFormatConfig(
      JSON.parse(config.report_format_config || "{}"),
      rubric
    ),
    rubric,
    (config.report_format ?? "").trim()
  );

  if (rubric.type !== "ponderaciones" || !isRubricConfigValid(rubric)) {
    yield { type: "error", error: "Rúbrica por ponderaciones no configurada correctamente" };
    return;
  }
  if (!isReportFormatValid(reportFormat, rubric)) {
    yield { type: "error", error: "Formato de informe (§6) incompleto" };
    return;
  }

  try {
    validateProjectElementsForEvaluation(projectElementsTable);
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  const scoreScale = rubric.scoreScale;
  const topN = evaluation.projectElementsInRagQuery;
  const phase = evaluation.phaseInstructions;
  const subdimensionScores: Record<string, number | null> = {};
  const partialAnalyses: string[] = [];
  const semaphore = getGlobalLlmSemaphore();

  const totalSubdims = rubric.dimensions.reduce((n, d) => n + d.subdimensions.length, 0);

  yield {
    type: "step",
    message: `Evaluando proyecto: ${rubric.dimensions.length} dimensión(es), ${totalSubdims} subdimensión(es), con documentación de referencia…`,
  };

  const dimCtx: DimensionEvalContext = {
    evaluationTypeId,
    projectElementsTable,
    rubric,
    reportFormat,
    evaluation,
    scoreScale,
    topN,
    phase,
    totalDimensions: rubric.dimensions.length,
    semaphore,
    precomputedSubdimensionChunks: options?.precomputedSubdimensionChunks,
  };

  if (evaluation.parallelDimensions && rubric.dimensions.length > 1) {
    const eventQueue: EvaluateStreamEvent[] = [];
    let notify: (() => void) | null = null;

    const onEvent = (event: EvaluateStreamEvent) => {
      eventQueue.push(event);
      notify?.();
      notify = null;
    };

    const waitForEvent = () =>
      new Promise<void>((resolve) => {
        if (eventQueue.length > 0) resolve();
        else notify = resolve;
      });

    const allDone = Promise.all(
      rubric.dimensions.map((dimConfig, i) =>
        evaluateSingleDimension(i, dimConfig, dimCtx, onEvent)
      )
    );

    while (true) {
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
      const race = await Promise.race([
        allDone.then(() => "done" as const),
        waitForEvent().then(() => "event" as const),
      ]);
      if (race === "done") {
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
        break;
      }
    }

    const dimensionResults = await allDone;
    dimensionResults.sort((a, b) => a.index - b.index);
    for (const result of dimensionResults) {
      partialAnalyses.push(result.dimText);
      Object.assign(subdimensionScores, result.subdimensionScores);
    }
  } else {
    for (let i = 0; i < rubric.dimensions.length; i++) {
      const result = await evaluateSingleDimension(i, rubric.dimensions[i], dimCtx);
      for (const event of result.events) {
        yield event;
      }
      partialAnalyses.push(result.dimText);
      Object.assign(subdimensionScores, result.subdimensionScores);
    }
  }

  const rawEvaluation = partialAnalyses.join("\n\n---\n\n");

  const scoreSchema = buildRubricScoreSchemaFromConfig(rubric);
  const evaluationScoresPayload = buildEvaluationScoresPayload(
    scoreSchema,
    subdimensionScores,
    evaluation.indicatorLabel
  );

  yield {
    type: "evaluation_scores",
    payload: evaluationScoresPayload,
  };

  yield {
    type: "formatting",
    message: "Informe final: integrando evaluación y redactando secciones con IA…",
  };

  // Borrador: el cliente no lo trata como informe final exportable.
  yield {
    type: "report_draft",
    content: stripCharacterLimitAnnotations(rawEvaluation),
  };

  let assembled: AssembleFinalReportResult | undefined;

  for await (const event of assembleFinalPonderacionesReportEvents({
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    subdimensionScores: evaluationScoresPayload.subdimensionScores,
    overallScore: evaluationScoresPayload.overallScore,
  })) {
    if (event.type === "step") {
      yield { type: "step", message: event.message };
    } else {
      assembled = event.result;
    }
  }

  if (!assembled) {
    throw new Error("El ensamblado del informe no produjo resultado.");
  }

  if (assembled.evaluationSummary.trim()) {
    yield { type: "evaluation_summary", text: assembled.evaluationSummary };
  }

  yield { type: "report_content", content: assembled.finalReport };

  // Índice IGIP solo al cerrar el informe final (las notas por subdimensión ya se emitieron en vivo).
  yield {
    type: "scores_summary",
    subdimensionScores: { ...assembled.subdimensionScores },
    overallScore: assembled.overallScore,
  };

  yield { type: "done" };
}
