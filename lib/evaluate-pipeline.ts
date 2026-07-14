import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { buildSystemContext } from "@/lib/build-context";
import { streamChat } from "@/lib/openrouter";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import { EvaluateLlmSemaphore } from "@/lib/evaluate-concurrency";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import { sanitizeLlmEvaluationText } from "@/lib/llm-output-sanitize";
import { collectAssembledReport, generateFinalSynthesisSection } from "@/lib/assemble-formatted-report";
import {
  enrichReportFormatWithLegacySections,
  findCustomSectionByTitlePattern,
  getSynthesisMaxChars,
  isReportFormatValid,
  mergeReportFormatConfig,
  type ReportFormatConfig,
} from "@/lib/report-format-config";
import {
  backfillSubdimensionScores,
  buildEvaluationInputForSummary,
  computeWeightedIndicatorScore,
  finalizeEvaluationSummary,
  formatIndicatorScore,
  injectAuthoritativeScoresSection,
  parseSubdimensionScore,
  parseSubdimensionScoreFromNamedSection,
  subdimensionScoreKey,
} from "@/lib/evaluation-scores";
import { mergeAuthoritativeScores } from "@/lib/evaluation-scores-json";
import {
  type RubricDimension,
  type RubricSubdimension,
} from "@/lib/rubric-dimensions";
import { buildSubdimensionKnowledgeQuery } from "@/lib/evaluate-rag-query";
import {
  buildRubricScoreSchemaFromConfig,
  isRubricConfigValid,
  mergeRubricConfig,
  subdimensionEvalContent,
  type RubricConfigPonderaciones,
} from "@/lib/rubric-config";
import type { RetrievedChunk } from "@/lib/chunk-types";
import { createEmptyArtifacts } from "@/lib/agent-tools";

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
  | { type: "evaluation_summary"; text: string }
  | { type: "assigned_level"; level: number | null; title: string }
  | {
      type: "variable_level";
      name: string;
      level: number | null;
      index: number;
      total: number;
    }
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

  return `Evalúa la subdimensión "${subdimension.name}" dentro de la dimensión "${dimension.name}".

Metodología:
1. Interpreta los criterios de la subdimensión y qué conlleva cada nota (${scoreExamples}).
2. Localiza en los elementos del proyecto la información que se refiere a "${subdimension.name}".
3. Con el marco teórico de ${label} (Knowledge), asigna la nota y redacta análisis, justificación y mejoras.

Usa ÚNICAMENTE:
- Los elementos identificados del proyecto en "Documentos del proyecto a evaluar".
- Los fragmentos de ${label} (Knowledge) incluidos en el contexto.
- Los criterios de la subdimensión en "Enfoque de esta evaluación parcial".

Incluye obligatoriamente estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
1. **Análisis** — evaluación rigurosa del proyecto según los criterios
2. **Nota** — OBLIGATORIO e INNEGOCIABLE:
   - Una línea exacta con el formato: Nota: N
   - N debe ser un único dígito: ${scoreExamples} (número arábigo, no palabras)
   - Prohibido omitir la nota, usar rangos, decimales o frases como "nota alta"
3. **Justificación** — fundamentada en el Knowledge y la evidencia del proyecto
4. **Posibles mejoras** — propuestas concretas y accionables

La línea "Nota: N" debe aparecer en su propia línea, después del Análisis y antes de la Justificación.
Ejemplo válido:
**Análisis**
(texto del análisis)

Nota: 3

**Justificación**
(texto)

Profundiza con detalle técnico del proyecto y del marco teórico sin inventar hechos.
${
  phaseInstructions.trim()
    ? `\n\nOrientación adicional para esta evaluación:\n${phaseInstructions.trim()}`
    : ""
}

No uses etiquetas <think>. Responde solo con la evaluación de esta subdimensión.`.trim();
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
};

async function runRagLlmPass(params: RagLlmPassParams): Promise<string> {
  return params.semaphore.run(async () => {
    const systemContent = await buildSystemContext(params.evaluationTypeId, [], {
      projectElementsTable: params.projectElementsTable,
      projectElementsOnly: true,
      excludeReportFormat: true,
      contextMode: "evaluate",
      ragQuery: params.ragQuery,
      evaluateSubdimension: params.evaluateSubdimension,
      agentArtifacts: params.precomputedKnowledgeChunks?.length
        ? { ...createEmptyArtifacts(), knowledgeChunks: params.precomputedKnowledgeChunks }
        : undefined,
    });

    const noThink =
      "Responde solo con el análisis de evaluación. No uses etiquetas <think>.\n\n";
    const systemMessage =
      noThink +
      (systemContent ||
        `Eres un evaluador de proyectos. Fundamenta el análisis en la rúbrica y ${params.knowledgeLabel}.`);

    return collectStream(
      [
        { role: "system", content: systemMessage },
        { role: "user", content: params.userPrompt },
      ],
      params.maxTokens
    );
  });
}

function evaluationSummaryPrompt(
  overallScore: number | null,
  evaluation: EvaluationConfig,
  summaryMaxChars: number
): string {
  const label = evaluation.indicatorLabel;
  return `Redacta una SÍNTESIS FINAL DE LA EVALUACIÓN (máximo ${summaryMaxChars} caracteres).

REGLAS OBLIGATORIAS:
- NO describas el proyecto, su objetivo, beneficiarios ni actividades.
- Resume el VEREDICTO evaluativo según la rúbrica ${label}: hallazgos evaluativos y conclusión.
${overallScore != null ? `- Incluye la nota ${label} ponderada: ${formatIndicatorScore(overallScore)}.` : "- Si puedes inferir la conclusión global, hazlo sin inventar una nota numérica."}
- Español claro, sin títulos, sin listas, sin markdown.
- Solo el texto de la síntesis evaluativa.`.trim();
}

async function generateEvaluationSummaryText(
  summaryInput: string,
  overallScore: number | null,
  schema: ReturnType<typeof buildRubricScoreSchemaFromConfig>,
  scores: Record<string, number | null>,
  evaluation: EvaluationConfig,
  summaryMaxChars: number,
  maxTokensOverride?: number,
  semaphore?: EvaluateLlmSemaphore
): Promise<string> {
  const defaultSystem = `Eres evaluador ${evaluation.indicatorLabel}. Escribes síntesis evaluativas concisas. NUNCA describas el proyecto, sus objetivos ni actividades. Solo veredicto evaluativo.`;
  let llmText = "";
  const maxTokens = maxTokensOverride ?? evaluation.maxTokens.summary;
  try {
    llmText = await collectStream(
      [
        { role: "system", content: defaultSystem },
        {
          role: "user",
          content: `${evaluationSummaryPrompt(overallScore, evaluation, summaryMaxChars)}\n\nDatos de evaluación (solo notas y conclusiones):\n${summaryInput.slice(0, 6000)}`,
        },
      ],
      maxTokens,
      semaphore
    );
  } catch {
    llmText = "";
  }
  return finalizeEvaluationSummary(
    llmText,
    schema,
    scores,
    overallScore,
    evaluation.indicatorLabel,
    summaryMaxChars
  );
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
    const subAnalysis = await runRagLlmPass({
      evaluationTypeId: ctx.evaluationTypeId,
      projectElementsTable: ctx.projectElementsTable,
      ragQuery: subQuery,
      evaluateSubdimension: {
        dimensionName: dim.name,
        name: sub.name,
        content: sub.content,
      },
      userPrompt: subdimensionUserPrompt(
        dim,
        sub,
        ctx.scoreScale,
        ctx.evaluation,
        ctx.phase.subdimensionEval
      ),
      maxTokens: ctx.evaluation.maxTokens.subdimension,
      knowledgeLabel: ctx.evaluation.knowledgeReferenceLabel,
      semaphore: ctx.semaphore,
      precomputedKnowledgeChunks: ctx.precomputedSubdimensionChunks?.[scoreKey],
    });
    return {
      j,
      sub,
      subAnalysis,
      parsedScore: parseSubdimensionScore(subAnalysis),
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
    emit({
      type: "subdimension",
      dimension: dim.name,
      name: result.sub.name,
      index: result.j + 1,
      total: subdims.length,
    });
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

  const scoreScale = rubric.scoreScale;
  const synthesisMax = getSynthesisMaxChars(reportFormat, rubric);
  const topN = evaluation.projectElementsInRagQuery;
  const phase = evaluation.phaseInstructions;
  const scoreSchema = buildRubricScoreSchemaFromConfig(rubric);
  const subdimensionScores: Record<string, number | null> = {};
  const partialAnalyses: string[] = [];
  const semaphore = new EvaluateLlmSemaphore();

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

  yield {
    type: "formatting",
    message: "Redactando resúmenes e integrando evaluación según formato…",
  };

  // Borrador inmediato: si Vercel corta el formateo (p. ej. Hobby), el cliente ya tiene contenido.
  yield {
    type: "report_content",
    content: stripCharacterLimitAnnotations(rawEvaluation),
  };

  const formatCustom = evaluation.prompts.formatInstructions?.trim();

  const assembled = await collectAssembledReport({
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    formatInstructionsExtra: formatCustom,
    semaphore,
  });

  let sanitized = stripCharacterLimitAnnotations(assembled);

  const regexBackfill = backfillSubdimensionScores(scoreSchema, {}, [
    rawEvaluation,
    sanitized,
  ]);

  const rawDeterministicScores: Record<string, number | null> = {};
  for (const entry of scoreSchema) {
    rawDeterministicScores[entry.key] = parseSubdimensionScoreFromNamedSection(
      rawEvaluation,
      entry.dimension,
      entry.name
    );
  }

  Object.assign(
    subdimensionScores,
    mergeAuthoritativeScores(scoreSchema, {}, [
      subdimensionScores,
      rawDeterministicScores,
      regexBackfill,
    ])
  );

  for (const entry of scoreSchema) {
    const score = subdimensionScores[entry.key];
    yield {
      type: "subdimension_score",
      dimension: entry.dimension,
      name: entry.name,
      score,
    };
  }

  const overallScore = computeWeightedIndicatorScore(scoreSchema, subdimensionScores);

  if (synthesisMax != null && synthesisMax > 0) {
    yield {
      type: "step",
      message: "Generando síntesis evaluativa final…",
    };

    const summaryInput = buildEvaluationInputForSummary(
      rawEvaluation,
      sanitized,
      scoreSchema,
      subdimensionScores
    );
    const synSection = findCustomSectionByTitlePattern(
      reportFormat,
      /síntesis|sintesis/i
    );
    const evaluationSummary = synSection
      ? await generateFinalSynthesisSection({
          synSection,
          rubric,
          evaluation,
          rawEvaluation,
          scoreSchema,
          subdimensionScores,
          overallScore,
          semaphore,
        })
      : await generateEvaluationSummaryText(
          summaryInput,
          overallScore,
          scoreSchema,
          subdimensionScores,
          evaluation,
          synthesisMax,
          evaluation.maxTokens.summary,
          semaphore
        );
    yield { type: "evaluation_summary", text: evaluationSummary.replace(/^##\s*[^\n]+\n+/, "").trim() };

    sanitized = `${sanitized.trimEnd()}\n\n${evaluationSummary.trim()}`;
  }

  const finalReport = injectAuthoritativeScoresSection(
    sanitized,
    scoreSchema,
    subdimensionScores,
    overallScore,
    evaluation.indicatorLabel
  );
  yield { type: "report_content", content: finalReport };

  yield {
    type: "scores_summary",
    subdimensionScores: { ...subdimensionScores },
    overallScore,
  };

  yield { type: "done" };
}
