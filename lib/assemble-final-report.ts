import {
  collectAssembledReport,
  countFormatLlmSections,
  generateFinalSynthesisSection,
} from "@/lib/assemble-formatted-report";
import {
  createFormatLlmSemaphore,
  type EvaluateLlmSemaphore,
} from "@/lib/evaluate-concurrency";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  backfillSubdimensionScores,
  buildEvaluationInputForSummary,
  computeWeightedIndicatorScore,
  finalizeEvaluationSummary,
  injectAuthoritativeScoresSection,
  parseSubdimensionScoreFromNamedSection,
  type RubricScoreSchemaEntry,
} from "@/lib/evaluation-scores";
import { mergeAuthoritativeScores } from "@/lib/evaluation-scores-json";
import {
  createFormatReportTelemetry,
  type FormatReportTelemetry,
} from "@/lib/format-report-telemetry";
import {
  findCustomSectionByTitlePattern,
  getSynthesisMaxChars,
  type ReportFormatConfig,
} from "@/lib/report-format-config";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import {
  buildRubricScoreSchemaFromConfig,
  type RubricConfig,
  type RubricConfigPonderaciones,
} from "@/lib/rubric-config";
import { FALLBACK_SUMMARY_SYSTEM_PROMPT } from "@/lib/system-prompts-catalog";

export type AssembleFinalReportResult = {
  finalReport: string;
  evaluationSummary: string;
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  scoreSchema: RubricScoreSchemaEntry[];
};

export type AssembleFinalReportEvent =
  | { type: "step"; message: string }
  | { type: "result"; result: AssembleFinalReportResult };

export type AssembleFinalNivelesReportEvent =
  | { type: "step"; message: string }
  | { type: "result"; result: { finalReport: string; evaluationSummary: string } };

type AssemblePonderacionesParams = {
  rubric: RubricConfigPonderaciones;
  reportFormat: ReportFormatConfig;
  rawEvaluation: string;
  projectElementsTable: { element: string; content: string }[];
  evaluation: EvaluationConfig;
  subdimensionScores?: Record<string, number | null>;
  overallScore?: number | null;
  semaphore?: EvaluateLlmSemaphore;
  onStep?: (message: string) => void;
  telemetry?: FormatReportTelemetry;
};

function resolveInitialPonderacionesScores(
  params: AssemblePonderacionesParams,
  scoreSchema: RubricScoreSchemaEntry[]
): Record<string, number | null> {
  const evaluationScores = params.subdimensionScores ?? {};
  const hasEvaluationScores = Object.values(evaluationScores).some((v) => v != null);
  const subdimensionScores: Record<string, number | null> = {};

  if (hasEvaluationScores) {
    for (const entry of scoreSchema) {
      subdimensionScores[entry.key] = evaluationScores[entry.key] ?? null;
    }
    return subdimensionScores;
  }

  const rawDeterministicScores: Record<string, number | null> = {};
  for (const entry of scoreSchema) {
    rawDeterministicScores[entry.key] = parseSubdimensionScoreFromNamedSection(
      params.rawEvaluation,
      entry.dimension,
      entry.name
    );
  }
  const regexBackfill = backfillSubdimensionScores(scoreSchema, {}, [params.rawEvaluation]);
  return mergeAuthoritativeScores(scoreSchema, {}, [rawDeterministicScores, regexBackfill]);
}

function backfillMissingPonderacionesScores(
  scoreSchema: RubricScoreSchemaEntry[],
  subdimensionScores: Record<string, number | null>,
  rawEvaluation: string,
  sanitized: string
): Record<string, number | null> {
  const missingKeys = scoreSchema.filter((e) => subdimensionScores[e.key] == null);
  if (missingKeys.length === 0) return subdimensionScores;

  const next = { ...subdimensionScores };
  const regexBackfill = backfillSubdimensionScores(scoreSchema, {}, [
    rawEvaluation,
    sanitized,
  ]);
  const rawDeterministicScores: Record<string, number | null> = {};
  for (const entry of missingKeys) {
    rawDeterministicScores[entry.key] = parseSubdimensionScoreFromNamedSection(
      rawEvaluation,
      entry.dimension,
      entry.name
    );
  }
  const backfilled = mergeAuthoritativeScores(scoreSchema, {}, [
    rawDeterministicScores,
    regexBackfill,
  ]);
  for (const entry of missingKeys) {
    if (backfilled[entry.key] != null) {
      next[entry.key] = backfilled[entry.key];
    }
  }
  return next;
}

async function generateFallbackSummary(
  summaryInput: string,
  overallScore: number | null,
  scoreSchema: RubricScoreSchemaEntry[],
  scores: Record<string, number | null>,
  evaluation: EvaluationConfig,
  summaryMaxChars: number,
  semaphore?: EvaluateLlmSemaphore
): Promise<string> {
  const defaultSystem = FALLBACK_SUMMARY_SYSTEM_PROMPT(evaluation.indicatorLabel);
  let llmText = "";
  try {
    const run = async () => {
      const { streamChat } = await import("@/lib/openrouter");
      let buf = "";
      const user = `Redacta una SÍNTESIS FINAL DE LA EVALUACIÓN (máximo ${summaryMaxChars} caracteres).

REGLAS OBLIGATORIAS:
- NO describas el proyecto, su objetivo, beneficiarios ni actividades.
- Resume el VEREDICTO evaluativo según la rúbrica ${evaluation.indicatorLabel}: hallazgos evaluativos y conclusión.
${overallScore != null ? `- Incluye la nota ${evaluation.indicatorLabel} ponderada.` : ""}
- Español claro, sin títulos, sin listas, sin markdown.
- Solo el texto de la síntesis evaluativa.

Datos de evaluación (solo notas y conclusiones):
${summaryInput.slice(0, 6000)}`;
      for await (const chunk of streamChat(
        [
          { role: "system", content: defaultSystem },
          { role: "user", content: user },
        ],
        { max_tokens: evaluation.maxTokens.summary, useCase: "evaluate" }
      )) {
        buf += chunk;
      }
      return buf;
    };
    llmText = semaphore ? await semaphore.run(run) : await run();
  } catch {
    llmText = "";
  }
  return finalizeEvaluationSummary(
    llmText,
    scoreSchema,
    scores,
    overallScore,
    evaluation.indicatorLabel,
    summaryMaxChars
  );
}

/**
 * Ensambla §6 con eventos de progreso en tiempo real (para el pipeline NDJSON).
 */

type StepEmit = (message: string) => { type: "step"; message: string };

type StepBridgeItem<T> =
  | { kind: "step" }
  | { kind: "done"; value: T }
  | { kind: "error"; error: unknown };

/** Puente onStep → yield: permite emitir pasos mientras await de trabajo LLM. */
function createStepBridge(onStep?: (message: string) => void) {
  const queue: string[] = [];
  let wake: (() => void) | null = null;

  const push = (message: string) => {
    onStep?.(message);
    queue.push(message);
    const w = wake;
    wake = null;
    w?.();
  };

  const drain = (): string[] => queue.splice(0, queue.length);

  const wait = (): Promise<void> => {
    if (queue.length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      wake = resolve;
    });
  };

  return { push, drain, wait };
}

async function* yieldStepsWhileAwaiting<T>(
  work: Promise<T>,
  bridge: ReturnType<typeof createStepBridge>,
  emit: StepEmit
): AsyncGenerator<{ type: "step"; message: string }, T> {
  const workDone: Promise<StepBridgeItem<T>> = work.then(
    (value) => ({ kind: "done", value }),
    (error) => ({ kind: "error", error })
  );

  for (;;) {
    for (const message of bridge.drain()) {
      yield emit(message);
    }

    const raced = await Promise.race([
      workDone,
      bridge.wait().then((): StepBridgeItem<T> => ({ kind: "step" })),
    ]);

    if (raced.kind === "step") continue;

    for (const message of bridge.drain()) {
      yield emit(message);
    }
    if (raced.kind === "error") throw raced.error;
    return raced.value;
  }
}

export async function* assembleFinalPonderacionesReportEvents(
  params: AssemblePonderacionesParams
): AsyncGenerator<AssembleFinalReportEvent> {
  const emit = (message: string) => {
    params.onStep?.(message);
    return { type: "step" as const, message };
  };

  const totalStarted = Date.now();
  const telemetry = params.telemetry ?? createFormatReportTelemetry();
  const llmCount = countFormatLlmSections(params.rubric, params.reportFormat);
  const formatSemaphore =
    params.semaphore ?? createFormatLlmSemaphore(llmCount);

  const {
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
  } = params;

  const scoreSchema = buildRubricScoreSchemaFromConfig(rubric);
  const formatCustom = [
    evaluation.prompts.formatSystem?.trim(),
    evaluation.prompts.formatInstructions?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  const synthesisMax = getSynthesisMaxChars(reportFormat, rubric);
  const synSection = findCustomSectionByTitlePattern(reportFormat, /síntesis|sintesis/i);

  let subdimensionScores = resolveInitialPonderacionesScores(params, scoreSchema);
  const overallScore =
    params.overallScore != null
      ? params.overallScore
      : computeWeightedIndicatorScore(scoreSchema, subdimensionScores);

  const bridge = createStepBridge(params.onStep);
  const pushStep = bridge.push;

  const assembleOptions = {
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    formatInstructionsExtra: formatCustom || undefined,
    semaphore: formatSemaphore,
    onStep: pushStep,
    telemetry,
  };

  const shouldSynthesize = synthesisMax != null && synthesisMax > 0;
  const canParallelSynthesis = shouldSynthesize && !!synSection;

  const sectionLabel =
    llmCount === 1 ? "1 sección con IA" : `${llmCount} secciones con IA`;
  yield emit(`Informe final: redactando ${sectionLabel}…`);

  const synthesisPromise = canParallelSynthesis
    ? generateFinalSynthesisSection({
        synSection: synSection!,
        rubric,
        evaluation,
        rawEvaluation,
        scoreSchema,
        subdimensionScores,
        overallScore,
        semaphore: formatSemaphore,
        onStep: pushStep,
        telemetry,
      })
    : null;

  const assembled = yield* yieldStepsWhileAwaiting(
    collectAssembledReport(assembleOptions),
    bridge,
    emit
  );
  let sanitized = stripCharacterLimitAnnotations(assembled);

  subdimensionScores = backfillMissingPonderacionesScores(
    scoreSchema,
    subdimensionScores,
    rawEvaluation,
    sanitized
  );
  const resolvedOverallScore =
    params.overallScore != null
      ? params.overallScore
      : computeWeightedIndicatorScore(scoreSchema, subdimensionScores);

  let evaluationSummary = "";
  if (shouldSynthesize) {
    if (synthesisPromise) {
      evaluationSummary = yield* yieldStepsWhileAwaiting(
        synthesisPromise,
        bridge,
        emit
      );
    } else {
      yield emit("Informe final: generando síntesis evaluativa…");
      const summaryInput = buildEvaluationInputForSummary(
        rawEvaluation,
        sanitized,
        scoreSchema,
        subdimensionScores
      );
      evaluationSummary = yield* yieldStepsWhileAwaiting(
        generateFallbackSummary(
          summaryInput,
          resolvedOverallScore,
          scoreSchema,
          subdimensionScores,
          evaluation,
          synthesisMax!,
          formatSemaphore
        ),
        bridge,
        emit
      );
      yield emit("Informe final: síntesis evaluativa lista.");
    }
    sanitized = `${sanitized.trimEnd()}\n\n${evaluationSummary.trim()}`;
  }

  const finalReport = injectAuthoritativeScoresSection(
    sanitized,
    scoreSchema,
    subdimensionScores,
    resolvedOverallScore,
    evaluation.indicatorLabel
  );

  telemetry.recordPhase({ phase: "total", ms: Date.now() - totalStarted });
  telemetry.logSummary("ponderaciones");

  yield {
    type: "result",
    result: {
      finalReport,
      evaluationSummary: evaluationSummary.replace(/^##\s*[^\n]+\n+/, "").trim(),
      subdimensionScores,
      overallScore: resolvedOverallScore,
      scoreSchema,
    },
  };
}

/**
 * Fase post-borrador IGIP (ponderaciones): ensambla §6, síntesis y Notas e índice
 * sin re-evaluar subdimensiones.
 */
export async function assembleFinalPonderacionesReport(
  params: AssemblePonderacionesParams
): Promise<AssembleFinalReportResult> {
  let result: AssembleFinalReportResult | undefined;
  for await (const event of assembleFinalPonderacionesReportEvents(params)) {
    if (event.type === "result") result = event.result;
  }
  if (!result) {
    throw new Error("El ensamblado del informe no produjo resultado.");
  }
  return result;
}

type AssembleNivelesParams = {
  rubric: RubricConfig;
  reportFormat: ReportFormatConfig;
  rawEvaluation: string;
  projectElementsTable: { element: string; content: string }[];
  evaluation: EvaluationConfig;
  assignedLevel: number | null;
  levelTitle: string;
  semaphore?: EvaluateLlmSemaphore;
  onStep?: (message: string) => void;
  telemetry?: FormatReportTelemetry;
};

/**
 * Ensambla §6 niveles con eventos de progreso en tiempo real.
 */
export async function* assembleFinalNivelesReportEvents(
  params: AssembleNivelesParams
): AsyncGenerator<AssembleFinalNivelesReportEvent> {
  const emit = (message: string) => {
    params.onStep?.(message);
    return { type: "step" as const, message };
  };

  const totalStarted = Date.now();
  const telemetry = params.telemetry ?? createFormatReportTelemetry();
  const llmCount = countFormatLlmSections(params.rubric, params.reportFormat);
  const formatSemaphore =
    params.semaphore ?? createFormatLlmSemaphore(llmCount);

  const {
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    assignedLevel,
    levelTitle,
  } = params;

  const custom = [
    evaluation.prompts.formatSystem?.trim(),
    evaluation.prompts.formatInstructions?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  const synthesisMax = getSynthesisMaxChars(reportFormat, rubric);
  const synSection = findCustomSectionByTitlePattern(reportFormat, /síntesis|sintesis/i);
  const hasSynthesis = synthesisMax != null && synthesisMax > 0 && synSection;

  const bridge = createStepBridge(params.onStep);
  const pushStep = bridge.push;

  const sectionLabel =
    llmCount === 1 ? "1 sección con IA" : `${llmCount} secciones con IA`;
  yield emit(`Informe final: redactando ${sectionLabel}…`);

  const synthesisPromise = hasSynthesis
    ? generateFinalSynthesisSection({
        synSection: synSection!,
        rubric,
        evaluation,
        rawEvaluation,
        scoreSchema: [],
        subdimensionScores: {},
        overallScore: null,
        assignedLevel,
        levelTitle,
        semaphore: formatSemaphore,
        onStep: pushStep,
        telemetry,
      })
    : null;

  const assembled = yield* yieldStepsWhileAwaiting(
    collectAssembledReport({
      rubric,
      reportFormat,
      rawEvaluation,
      projectElementsTable,
      evaluation,
      formatInstructionsExtra: custom || undefined,
      semaphore: formatSemaphore,
      onStep: pushStep,
      telemetry,
    }),
    bridge,
    emit
  );

  let sanitized = stripCharacterLimitAnnotations(assembled);
  let evaluationSummary = "";

  if (synthesisPromise) {
    evaluationSummary = yield* yieldStepsWhileAwaiting(
      synthesisPromise,
      bridge,
      emit
    );
    sanitized = `${sanitized.trimEnd()}\n\n${evaluationSummary.trim()}`;
  }

  telemetry.recordPhase({ phase: "total", ms: Date.now() - totalStarted });
  telemetry.logSummary("niveles");

  yield {
    type: "result",
    result: {
      finalReport: sanitized,
      evaluationSummary: evaluationSummary.replace(/^##\s*[^\n]+\n+/, "").trim(),
    },
  };
}

/**
 * Fase post-borrador para rúbrica por niveles: ensambla §6 + síntesis (sin bloque de notas).
 */
export async function assembleFinalNivelesReport(
  params: AssembleNivelesParams
): Promise<{ finalReport: string; evaluationSummary: string }> {
  let result: { finalReport: string; evaluationSummary: string } | undefined;
  for await (const event of assembleFinalNivelesReportEvents(params)) {
    if (event.type === "result") result = event.result;
  }
  if (!result) {
    throw new Error("El ensamblado del informe no produjo resultado.");
  }
  return result;
}

