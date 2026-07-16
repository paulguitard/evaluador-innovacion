import {
  extractSubdimensionSection,
  type RubricScoreSchemaEntry,
} from "@/lib/evaluation-scores";
import type { EvaluateLlmSemaphore } from "@/lib/evaluate-concurrency";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  buildFinalSynthesisSystemPrompt,
  buildFinalSynthesisSystemPromptForLevels,
  buildIncompleteSectionRetryUser,
  buildSectionFormatSystemPrompt,
  buildSectionFormatUserPrompt,
  buildSynthesisSourceMaterial,
  buildSynthesisSourceMaterialForLevels,
  customSectionToReportSection,
  estimateSectionMaxTokens,
  extractSectionBody,
  getSectionRejectionReason,
  isLightTruncationOnly,
  isSectionTextComplete,
  resolveSectionSource,
  sectionAcceptsLightTruncation,
} from "@/lib/format-report-sections";
import { buildDeterministicLevelsEvaluationSummary } from "@/lib/evaluation-scores";
import type { FormatReportTelemetry } from "@/lib/format-report-telemetry";
import {
  extractGlobalLevelSection,
  extractVariableSection,
} from "@/lib/rubric-niveles";
import {
  expandReportSections,
  type ReportCustomSection,
  type ReportFormatConfig,
  type ReportSection,
} from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";
import { sanitizeLlmEvaluationText } from "@/lib/llm-output-sanitize";

/** Intentos por ronda de completitud (antes 3+1). */
const SECTION_LLM_MAX_ATTEMPTS = 2;

export type AssembleFormattedReportOptions = {
  rubric: RubricConfig;
  reportFormat: ReportFormatConfig;
  rawEvaluation: string;
  projectElementsTable: { element: string; content: string }[];
  evaluation: EvaluationConfig;
  formatInstructionsExtra?: string;
  semaphore?: EvaluateLlmSemaphore;
  streamSection?: (
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    maxTokens: number
  ) => AsyncGenerator<string, void, unknown>;
  onStep?: (message: string) => void;
  telemetry?: FormatReportTelemetry;
};

export type GenerateFinalSynthesisOptions = {
  synSection: ReportCustomSection;
  rubric: RubricConfig;
  evaluation: EvaluationConfig;
  rawEvaluation: string;
  scoreSchema: RubricScoreSchemaEntry[];
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  assignedLevel?: number | null;
  levelTitle?: string;
  semaphore?: EvaluateLlmSemaphore;
  streamSection?: AssembleFormattedReportOptions["streamSection"];
  onStep?: (message: string) => void;
  telemetry?: FormatReportTelemetry;
};

export function isSynthesisSection(section: ReportSection): boolean {
  return section.kind === "custom" && /síntesis|sintesis/i.test(section.title);
}

export function sectionNeedsLlm(section: ReportSection): boolean {
  if (section.kind === "dimension_overview") return true;
  if (section.kind === "custom" && !isSynthesisSection(section)) return true;
  return false;
}

/** Cuenta secciones LLM de formateo (sin síntesis). */
export function countFormatLlmSections(
  rubric: RubricConfig,
  reportFormat: ReportFormatConfig
): number {
  return expandReportSections(rubric, reportFormat).filter(
    (section) => sectionNeedsLlm(section) && !isSynthesisSection(section)
  ).length;
}

/**
 * Cuerpo de subdimensión sin encabezado ## título (para igualdad verbatim).
 */
export function extractSubdimensionBodyFromFormattedBlock(
  formattedBlock: string,
  subdimensionTitle: string
): string {
  const escaped = subdimensionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return formattedBlock
    .replace(new RegExp(`^#{1,3}\\s*${escaped}\\s*\\n+`, "i"), "")
    .trim();
}

/** Copia verbatim el análisis bruto; no aplica maxChars ni re-LLM. */
export function formatSubdimensionBlock(
  section: ReportSection,
  rubric: RubricConfig,
  rawEvaluation: string
): string {
  let body = "";
  if (
    section.kind === "subdimension_eval" &&
    section.subdimensionId &&
    rubric.type === "ponderaciones"
  ) {
    for (const dim of rubric.dimensions) {
      const sub = dim.subdimensions.find((s) => s.id === section.subdimensionId);
      if (sub) {
        body = extractSubdimensionSection(rawEvaluation, sub.name) ?? "";
        break;
      }
    }
  }
  const trimmed = body.trim();
  if (!trimmed) return `## ${section.title}\n\n`;
  return `## ${section.title}\n\n${trimmed}`;
}

export function formatVariableBlock(
  section: ReportSection,
  rubric: RubricConfig,
  rawEvaluation: string
): string {
  if (section.kind !== "variable_eval" || !section.variableId || rubric.type !== "niveles") {
    return `## ${section.title}\n\n`;
  }
  const variable = rubric.variables.find((v) => v.id === section.variableId);
  if (!variable) return `## ${section.title}\n\n`;
  const body = extractVariableSection(rawEvaluation, variable.name)?.trim() ?? "";
  if (!body) return `## ${section.title}\n\n`;
  return `## ${section.title}\n\n${body}`;
}

export function formatAssignedLevelBlock(
  section: ReportSection,
  rawEvaluation: string
): string {
  const body = extractGlobalLevelSection(rawEvaluation)?.trim() ?? rawEvaluation.trim();
  if (!body) return `## ${section.title}\n\n`;
  return `## ${section.title}\n\n${body}`;
}

function sectionHasHeader(text: string, title: string): boolean {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*#{1,3}\\s*${escaped}\\b`, "i").test(text.trim());
}

function ensureSectionHeader(text: string, title: string): string {
  const trimmed = text.trim();
  if (!trimmed) return `## ${title}\n\n`;
  if (sectionHasHeader(trimmed, title)) return trimmed;
  return `## ${title}\n\n${trimmed}`;
}

function looksLikeRawProjectPaste(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  const labelHits = lines.filter((l) =>
    /^(nombre del proyecto|objetivo general|objetivos específicos|público objetivo|actividades del proyecto|indicadores)\b/i.test(
      l.trim()
    )
  );
  return labelHits.length >= 3;
}

function sectionId(section: ReportSection): string {
  return section.id ?? section.title;
}

async function streamToText(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens: number,
  options: Pick<AssembleFormattedReportOptions, "streamSection" | "semaphore">
): Promise<string> {
  const run = async (): Promise<string> => {
    let buf = "";
    if (options.streamSection) {
      for await (const chunk of options.streamSection(messages, maxTokens)) {
        buf += chunk;
      }
    } else {
      const { streamChat } = await import("@/lib/openrouter");
      for await (const chunk of streamChat(messages, {
        max_tokens: maxTokens,
        useCase: "evaluate",
        // Evita que providers de reasoning (Phala/Google-Vertex/Groq de gpt-oss)
        // consuman todo el presupuesto en thinking invisible sin emitir content.
        disableReasoning: true,
      })) {
        buf += chunk;
      }
    }
    return sanitizeLlmEvaluationText(buf);
  };
  return options.semaphore ? options.semaphore.run(run) : run();
}

async function callLlmSection(
  section: ReportSection,
  system: string,
  user: string,
  maxTokens: number,
  options: Pick<AssembleFormattedReportOptions, "streamSection" | "semaphore">
): Promise<string> {
  return (
    await streamToText(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens,
      options
    )
  ).trim();
}

function sectionTextIsAcceptable(section: ReportSection, llmText: string): boolean {
  const body = extractSectionBody(llmText, section.title);
  if (!body) return false;
  if (!isSectionTextComplete(body, section.minChars)) return false;
  if (
    section.kind === "custom" &&
    /resumen.*proyecto|proyecto.*resumen/i.test(section.title) &&
    looksLikeRawProjectPaste(llmText)
  ) {
    return false;
  }
  return true;
}

type LlmSectionRequestOptions = Pick<
  AssembleFormattedReportOptions,
  "streamSection" | "semaphore" | "telemetry" | "onStep"
> & {
  progress?: { index: number; total: number };
};

async function requestLlmSection(
  section: ReportSection,
  system: string,
  user: string,
  maxTokens: number,
  options: LlmSectionRequestOptions,
  sourceForRetry = "",
  round: "primary" | "final" = "primary"
): Promise<string> {
  const tokenCeiling = Math.min(8192, Math.max(maxTokens, estimateSectionMaxTokens(section)));
  let tokens = tokenCeiling;
  let best = "";
  let lastUser = user;
  const maxAttempts = round === "final" ? 1 : SECTION_LLM_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const started = Date.now();
    let llmText = "";
    if (attempt > 0 || round === "final") {
      const progress = options.progress;
      const prefix = progress
        ? `Informe final: reintentando ${progress.index}/${progress.total}`
        : "Informe final: reintentando";
      options.onStep?.(
        round === "final"
          ? `${prefix} «${section.title}» (intento final)…`
          : `${prefix} «${section.title}» (intento ${attempt + 1})…`
      );
    }
    try {
      llmText = await callLlmSection(section, system, lastUser, tokens, options);
    } catch (e) {
      options.telemetry?.recordAttempt({
        sectionId: sectionId(section),
        sectionTitle: section.title,
        attempt,
        round,
        ms: Date.now() - started,
        acceptable: false,
        reason: `provider_error:${e instanceof Error ? e.message : String(e)}`,
        chars: 0,
      });
      throw e;
    }

    const acceptable = sectionTextIsAcceptable(section, llmText);
    const rejectionReason = acceptable ? undefined : getSectionRejectionReason(section, llmText);
    options.telemetry?.recordAttempt({
      sectionId: sectionId(section),
      sectionTitle: section.title,
      attempt,
      round,
      ms: Date.now() - started,
      acceptable,
      reason: rejectionReason,
      chars: llmText.length,
    });
    if (llmText.length > best.length) best = llmText;
    if (acceptable) return llmText;

    // Si el fallo fue empty_body (rawLen=0, chunkCount ≈ maxTokens), el modelo agotó
    // el presupuesto en reasoning sin llegar a content: escalar más agresivo (x1.6).
    const escalation = rejectionReason === "empty_body" ? 1.6 : 1.25;
    tokens = Math.min(8192, Math.ceil(tokens * escalation));
    if (sourceForRetry.trim()) {
      lastUser = buildIncompleteSectionRetryUser(section, sourceForRetry);
    }
  }

  return best;
}

async function collectLlmSection(
  section: ReportSection,
  options: AssembleFormattedReportOptions,
  progress?: { index: number; total: number }
): Promise<string> {
  const {
    rubric,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    formatInstructionsExtra,
    onStep,
  } = options;

  const label = progress
    ? `Informe final: redactando ${progress.index}/${progress.total} «${section.title}»…`
    : `Informe final: redactando «${section.title}»…`;
  onStep?.(label);

  const source = resolveSectionSource(
    section,
    rubric,
    rawEvaluation,
    projectElementsTable
  );
  let system = buildSectionFormatSystemPrompt(section, rubric);
  if (formatInstructionsExtra?.trim()) {
    system += `\n\n${formatInstructionsExtra.trim()}`;
  }
  const user = buildSectionFormatUserPrompt(section, source);
  const maxTokens = Math.min(
    evaluation.maxTokens.formatReport,
    estimateSectionMaxTokens(section)
  );

  const llmOpts: LlmSectionRequestOptions = { ...options, progress };

  let llmText = await requestLlmSection(
    section,
    system,
    user,
    maxTokens,
    llmOpts,
    source,
    "primary"
  );

  if (sectionTextIsAcceptable(section, llmText)) {
    onStep?.(
      progress
        ? `Informe final: lista ${progress.index}/${progress.total} «${section.title}».`
        : `Informe final: lista «${section.title}».`
    );
    return ensureSectionHeader(llmText, section.title);
  }

  const primaryText = llmText;
  const retryUser = buildIncompleteSectionRetryUser(section, source);
  llmText = await requestLlmSection(
    section,
    system,
    retryUser,
    8192,
    llmOpts,
    source,
    "final"
  );

  if (
    !sectionTextIsAcceptable(section, llmText) &&
    sectionAcceptsLightTruncation(section)
  ) {
    const lightCandidate = [llmText, primaryText].find((candidate) =>
      isLightTruncationOnly(section, candidate)
    );
    if (lightCandidate) {
      llmText = lightCandidate;
    }
  }

  onStep?.(
    progress
      ? `Informe final: lista ${progress.index}/${progress.total} «${section.title}».`
      : `Informe final: lista «${section.title}».`
  );
  return ensureSectionHeader(llmText, section.title);
}

function llmSectionCacheKey(section: ReportSection): string {
  if (section.kind === "dimension_overview") {
    return `dimension_overview:${section.dimensionId ?? section.title}`;
  }
  return `custom:${section.title}`;
}

async function prefetchLlmSections(
  sections: ReportSection[],
  options: AssembleFormattedReportOptions
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const llmSections = sections.filter(
    (section) => sectionNeedsLlm(section) && !isSynthesisSection(section)
  );

  const started = Date.now();
  const total = llmSections.length;
  if (total > 0) {
    options.onStep?.(
      total === 1
        ? "Informe final: 1 sección pendiente de redacción con IA…"
        : `Informe final: ${total} secciones pendientes de redacción con IA…`
    );
  }
  await Promise.all(
    llmSections.map(async (section, index) => {
      const text = await collectLlmSection(section, options, {
        index: index + 1,
        total,
      });
      cache.set(llmSectionCacheKey(section), text);
    })
  );
  options.telemetry?.recordPhase({ phase: "prefetch", ms: Date.now() - started });

  return cache;
}

export async function generateFinalSynthesisSection(
  options: GenerateFinalSynthesisOptions
): Promise<string> {
  const {
    synSection,
    rubric,
    evaluation,
    rawEvaluation,
    scoreSchema,
    subdimensionScores,
    overallScore,
    assignedLevel,
    levelTitle,
    semaphore,
    streamSection,
    onStep,
    telemetry,
  } = options;

  onStep?.("Informe final: generando síntesis evaluativa…");
  const synthesisStarted = Date.now();

  const section = customSectionToReportSection(synSection);
  const source =
    rubric.type === "niveles"
      ? buildSynthesisSourceMaterialForLevels(
          rawEvaluation,
          assignedLevel ?? null,
          levelTitle ?? "",
          evaluation.indicatorLabel
        )
      : buildSynthesisSourceMaterial(
          rawEvaluation,
          scoreSchema,
          subdimensionScores,
          overallScore,
          evaluation.indicatorLabel
        );
  const system =
    rubric.type === "niveles"
      ? buildFinalSynthesisSystemPromptForLevels(
          section,
          assignedLevel ?? null,
          levelTitle ?? ""
        )
      : buildFinalSynthesisSystemPrompt(section);
  const user = `Redacta la síntesis evaluativa final según las instrucciones.

${source}

Responde solo con la sección formateada.`;
  const maxTokens = Math.min(
    evaluation.maxTokens.formatReport,
    estimateSectionMaxTokens(section)
  );
  const llmOpts = { semaphore, streamSection, telemetry };

  let text = await requestLlmSection(section, system, user, maxTokens, llmOpts, source, "primary");
  if (!sectionTextIsAcceptable(section, text)) {
    text = await requestLlmSection(
      section,
      system,
      buildIncompleteSectionRetryUser(section, source),
      8192,
      llmOpts,
      source,
      "final"
    );
  }

  if (!sectionTextIsAcceptable(section, text) && rubric.type === "niveles") {
    const fallback = buildDeterministicLevelsEvaluationSummary(
      assignedLevel ?? null,
      levelTitle ?? "",
      evaluation.indicatorLabel,
      rawEvaluation,
      section.maxChars
    );
    text = `## ${section.title}\n\n${fallback}`;
  }

  telemetry?.recordPhase({ phase: "synthesis", ms: Date.now() - synthesisStarted });
  onStep?.("Informe final: síntesis evaluativa lista.");

  return ensureSectionHeader(text, section.title);
}

export async function* assembleFormattedReport(
  options: AssembleFormattedReportOptions
): AsyncGenerator<string, void, unknown> {
  const { rubric, reportFormat, rawEvaluation } = options;
  const sections = expandReportSections(rubric, reportFormat);
  const llmCache = await prefetchLlmSections(sections, options);
  let isFirst = true;

  const prefix = (): string => {
    if (isFirst) {
      isFirst = false;
      return "";
    }
    return "\n\n";
  };

  for (const section of sections) {
    if (isSynthesisSection(section)) continue;

    if (section.kind === "subdimension_eval") {
      yield prefix() + formatSubdimensionBlock(section, rubric, rawEvaluation);
      continue;
    }

    if (section.kind === "variable_eval") {
      yield prefix() + formatVariableBlock(section, rubric, rawEvaluation);
      continue;
    }

    if (section.kind === "assigned_level") {
      yield prefix() + formatAssignedLevelBlock(section, rawEvaluation);
      continue;
    }

    if (sectionNeedsLlm(section)) {
      const cached = llmCache.get(llmSectionCacheKey(section));
      yield prefix() + (cached ?? `## ${section.title}\n\n`);
    }
  }
}

export async function collectAssembledReport(
  options: AssembleFormattedReportOptions
): Promise<string> {
  const started = Date.now();
  let out = "";
  for await (const chunk of assembleFormattedReport(options)) {
    out += chunk;
  }
  options.telemetry?.recordPhase({ phase: "assemble", ms: Date.now() - started });
  return out;
}

export function countSubdimensionTitleOccurrences(
  report: string,
  subdimensionName: string
): number {
  const escaped = subdimensionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\d+\\.\\s*)?${escaped}\\b`,
    "gi"
  );
  return [...report.matchAll(re)].length;
}

