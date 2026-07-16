import { chatCompletion } from "@/lib/openrouter";
import {
  classifyChatIntent,
  chatIntentToContextMode,
  parsePageFromQuery,
  parseChapterFromQuery,
  parseChaptersFromQuery,
  isChapterComparisonQuery,
} from "@/lib/chat-intent";
import {
  type ContextPlan,
  type AgentLevel,
  type ContextComplexity,
  validateAndNormalizePlan,
  knowledgeOnlyPlan,
  multiChapterComparisonPlan,
  projectOnlyPlan,
  configOnlyPlan,
  bulkEvaluationPlan,
} from "@/lib/context-plan";
import type { ContextMode } from "@/lib/rag-limits";
import { loadChatAgentConfig } from "@/lib/chat-agent-config-server";
import type { ChatAgentConfig } from "@/lib/chat-agent-config";
import {
  applyHardRules,
  type RouterInput,
} from "@/lib/context-router-rules";

export type { RouterInput } from "@/lib/context-router-rules";
export { asksScoreImprovement, applyHardRules } from "@/lib/context-router-rules";

function intentToDefaultPlan(
  intent: string,
  message: string,
  input: RouterInput,
  contextMode: ContextMode,
  agentConfig: ChatAgentConfig,
  page?: number,
  chapter?: number
): ContextPlan {
  if (page != null || chapter != null) {
    return knowledgeOnlyPlan(
      page != null
        ? `Manual Oslo página ${page} chapter section content`
        : `Manual Oslo Chapter ${chapter} capítulo ${chapter} resumen`,
      page,
      chapter,
      agentConfig
    );
  }
  if (input.hasBulkEvaluationData && !input.hasProjectData) {
    return bulkEvaluationPlan(message, agentConfig);
  }
  if (intent === "knowledge") {
    return knowledgeOnlyPlan(message, undefined, undefined, agentConfig);
  }
  if (intent === "project") {
    return projectOnlyPlan(message, agentConfig);
  }
  return configOnlyPlan(agentConfig);
}

function parseRouterJson(raw: string): Partial<ContextPlan> | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as Partial<ContextPlan>;
  } catch {
    return null;
  }
}

function mapComplexityToLevel(complexity: ContextComplexity, useToolLoop: boolean): AgentLevel {
  if (!useToolLoop) return "A";
  if (complexity === "complex") return "C";
  if (complexity === "moderate") return "B";
  return "A";
}

/**
 * Nivel A: router LLM + reglas duras + fallback regex.
 */
export async function routeContextPlan(input: RouterInput): Promise<ContextPlan> {
  const agentConfig = await loadChatAgentConfig();
  const pageNumber = parsePageFromQuery(input.message);
  const chapterNumbers = parseChaptersFromQuery(input.message);
  const chapterNumber =
    pageNumber == null && chapterNumbers.length === 1 ? chapterNumbers[0] : undefined;
  const multiChapterCompare =
    chapterNumbers.length >= 2 || isChapterComparisonQuery(input.message);

  const regexIntent =
    pageNumber != null || chapterNumber != null || multiChapterCompare
      ? "knowledge"
      : classifyChatIntent(input.message, input.hasProjectData || !!input.hasBulkEvaluationData);
  const contextMode: ContextMode =
    chapterNumber != null && !multiChapterCompare
      ? "chat-chapter"
      : chatIntentToContextMode(regexIntent);

  if (multiChapterCompare && chapterNumbers.length >= 2) {
    const plan = applyHardRules(
      multiChapterComparisonPlan(input.message, chapterNumbers, agentConfig),
      input.message,
      input,
      agentConfig
    );
    return plan;
  }

  const fallback = intentToDefaultPlan(
    regexIntent,
    input.message,
    input,
    contextMode,
    agentConfig,
    pageNumber,
    chapterNumber
  );

  if (pageNumber != null || chapterNumber != null) {
    return applyHardRules(fallback, input.message, input, agentConfig);
  }

  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: agentConfig.routerSystemPrompt },
        {
          role: "user",
          content: `Pregunta del usuario: ${input.message}

Disponibilidad:
- Proyecto subido: ${input.hasProjectData ? "sí" : "no"}
- Evaluación masiva completada: ${input.hasBulkEvaluationData ? "sí" : "no"}
- Rúbrica configurada: ${input.hasRubric ? "sí" : "no"}
- Knowledge indexado: ${input.hasKnowledge ? "sí" : "no"}`,
        },
      ],
      { max_tokens: 900, temperature: 0.1, useCase: "router" }
    );

    const parsed = parseRouterJson(raw);
    if (parsed) {
      const useToolLoop = parsed.useToolLoop === true;
      const complexity = parsed.complexity ?? fallback.complexity;
      const agentLevel =
        parsed.agentLevel ?? mapComplexityToLevel(complexity, useToolLoop);
      const plan = validateAndNormalizePlan(
        {
          ...parsed,
          agentLevel,
          complexity,
          useToolLoop,
          pageNumber,
          chapterNumber,
          ragMode: parsed.ragMode ?? contextMode,
          ragQuery: parsed.ragQuery ?? input.message,
        },
        fallback
      );
      return applyHardRules(plan, input.message, input, agentConfig);
    }
  } catch {
    /* fallback regex */
  }

  return applyHardRules(fallback, input.message, input, agentConfig);
}

export function planToIntentLabel(plan: ContextPlan): string {
  return plan.intentLabel;
}

export function planSourcesSummary(plan: ContextPlan): string {
  const inc = plan.sources.join(", ") || "ninguna";
  const exc = plan.excludeSources.length ? plan.excludeSources.join(", ") : "ninguna";
  return `Incluir: ${inc}. Excluir: ${exc}. Nivel agente: ${plan.agentLevel}.`;
}
