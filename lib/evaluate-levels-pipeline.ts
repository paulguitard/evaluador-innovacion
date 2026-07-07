import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { buildSystemContext } from "@/lib/build-context";
import { streamChat } from "@/lib/openrouter";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  collectAssembledReport,
  generateFinalSynthesisSection,
} from "@/lib/assemble-formatted-report";
import {
  enrichReportFormatWithLegacySections,
  findCustomSectionByTitlePattern,
  getSynthesisMaxChars,
  isReportFormatValid,
  mergeReportFormatConfig,
} from "@/lib/report-format-config";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import {
  isRubricConfigValid,
  mergeRubricConfig,
  type RubricConfigNiveles,
} from "@/lib/rubric-config";
import type { EvaluateStreamEvent } from "@/lib/evaluate-pipeline";

async function collectStream(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens: number
): Promise<string> {
  let out = "";
  for await (const chunk of streamChat(messages, { max_tokens: maxTokens, useCase: "evaluate" })) {
    out += chunk;
  }
  return out;
}

function levelsRubricText(levels: RubricConfigNiveles["levels"]): string {
  return levels
    .map((l) => `Nivel ${l.level} — ${l.title}\n${l.description}`)
    .join("\n\n");
}

function assignLevelPrompt(rubric: RubricConfigNiveles, evaluation: EvaluationConfig): string {
  const nums = rubric.levels.map((l) => l.level).join(", ");
  const label = evaluation.knowledgeReferenceLabel;
  const phase = evaluation.phaseInstructions.assignedLevel.trim();

  return `Asigna UN ÚNICO nivel global al proyecto según la escala de niveles.

Metodología:
1. Lee los criterios de cada nivel en la rúbrica.
2. Contrasta con los elementos del proyecto y ${label} (Knowledge).
3. Elige el nivel que mejor describe el estado actual del proyecto.

REGLAS:
- Responde con estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
  1. **Análisis** — evidencia del proyecto respecto a los criterios
  2. **Nivel asignado** — una línea exacta: Nivel: N (donde N es uno de: ${nums})
  3. **Justificación** — por qué ese nivel y no otro adyacente

La línea "Nivel: N" debe estar en su propia línea.
No uses etiquetas <think>.
${phase ? `\n\nOrientación adicional:\n${phase}` : ""}`.trim();
}

function parseAssignedLevel(text: string, rubric: RubricConfigNiveles): number | null {
  const m = /Nivel\s*:\s*(\d+)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const valid = rubric.levels.some((l) => l.level === n);
  return valid ? n : null;
}

/**
 * Evaluación por niveles globales (IMET/TRL): un nivel + justificación, informe desde §6.
 */
export async function* runEvaluateLevelsPipeline(
  evaluationTypeId: number,
  projectElementsTable: { element: string; content: string }[]
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
    mergeReportFormatConfig(JSON.parse(config.report_format_config || "{}"), rubric),
    rubric,
    (config.report_format ?? "").trim()
  );

  if (rubric.type !== "niveles" || !isRubricConfigValid(rubric)) {
    yield { type: "error", error: "Rúbrica de niveles no configurada correctamente" };
    return;
  }
  if (!isReportFormatValid(reportFormat, rubric)) {
    yield { type: "error", error: "Formato de informe (§6) incompleto" };
    return;
  }

  const synthesisMax = getSynthesisMaxChars(reportFormat, rubric);

  yield { type: "step", message: "Evaluando nivel global del proyecto…" };

  const rubricText = levelsRubricText(rubric.levels);
  const systemContent = await buildSystemContext(evaluationTypeId, [], {
    projectElementsTable,
    projectElementsOnly: true,
    excludeReportFormat: true,
    contextMode: "evaluate",
    ragQuery: [rubricText.slice(0, 800), projectElementsTable.map((r) => r.element).join(" ")]
      .filter(Boolean)
      .join(" "),
    evaluateSubdimension: {
      dimensionName: "Nivel global",
      name: "Asignación de nivel",
      content: rubricText,
    },
  });

  const rawEvaluation = await collectStream(
    [
      {
        role: "system",
        content:
          (systemContent || "Eres evaluador de proyectos.") +
          "\n\nResponde solo con el análisis. No uses etiquetas <think>.",
      },
      { role: "user", content: assignLevelPrompt(rubric, evaluation) },
    ],
    evaluation.maxTokens.subdimension
  );

  const assignedLevel = parseAssignedLevel(rawEvaluation, rubric);
  const levelMeta = rubric.levels.find((l) => l.level === assignedLevel);

  yield {
    type: "assigned_level" as const,
    level: assignedLevel,
    title: levelMeta?.title ?? "",
  };

  yield { type: "formatting", message: "Redactando resúmenes e integrando evaluación según formato…" };

  const custom = evaluation.prompts.formatInstructions?.trim();
  const assembled = await collectAssembledReport({
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    formatInstructionsExtra: custom,
  });

  let sanitized = stripCharacterLimitAnnotations(assembled);

  const synSection = findCustomSectionByTitlePattern(reportFormat, /síntesis|sintesis/i);
  const hasSynthesis = synthesisMax != null && synthesisMax > 0 && synSection;

  if (hasSynthesis) {
    yield { type: "step", message: "Generando síntesis evaluativa final…" };

    const evaluationSummary = await generateFinalSynthesisSection({
      synSection,
      rubric,
      evaluation,
      rawEvaluation,
      scoreSchema: [],
      subdimensionScores: {},
      overallScore: null,
      assignedLevel,
      levelTitle: levelMeta?.title ?? "",
    });

    yield {
      type: "evaluation_summary",
      text: evaluationSummary.replace(/^##\s*[^\n]+\n+/, "").trim(),
    };

    sanitized = `${sanitized.trimEnd()}\n\n${evaluationSummary.trim()}`;
  }

  yield { type: "report_content", content: sanitized };
  yield { type: "done" };
}
