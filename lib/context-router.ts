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
} from "@/lib/context-plan";
import type { ContextMode } from "@/lib/rag-limits";
import { loadChatAgentConfig } from "@/lib/chat-agent-config-server";
import type { ChatAgentConfig } from "@/lib/chat-agent-config";

export type RouterInput = {
  message: string;
  hasProjectData: boolean;
  hasRubric: boolean;
  hasKnowledge: boolean;
};

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
  if (intent === "knowledge") {
    return knowledgeOnlyPlan(message, undefined, undefined, agentConfig);
  }
  if (intent === "project") {
    return projectOnlyPlan(message);
  }
  return configOnlyPlan();
}

function applyHardRules(
  plan: ContextPlan,
  message: string,
  input: RouterInput,
  agentConfig: ChatAgentConfig
): ContextPlan {
  const m = message.toLowerCase();
  let p = { ...plan };

  const asksRubric =
    /\br[uú]brica\b/i.test(message) ||
    /\bcriterios?\s+de\s+evaluaci[oó]n\b/i.test(message) ||
    /\bigip\b/i.test(message);
  const asksKnowledge =
    /\b(manual|knowledge|oslo|marco\s+te[oó]rico)\b/i.test(message) ||
    /\bqu[eé]\s+es\s+la\s+innovaci[oó]n\b/i.test(message);
  const asksProject = /\bproyecto\b/i.test(message) || input.hasProjectData;
  const asksConfig =
    /\b(evaluaci[oó]n|formato\s+del\s+informe|elementos?\s+a\s+identificar|configuraci[oó]n)\b/i.test(
      message
    );

  const chapterNumbers = parseChaptersFromQuery(message);
  const multiChapter = chapterNumbers.length >= 2 || isChapterComparisonQuery(message);

  if (multiChapter && asksKnowledge && !asksRubric && !asksConfig) {
    const nums =
      chapterNumbers.length >= 2 ? chapterNumbers : chapterNumbers.length === 1 ? chapterNumbers : [];
    if (nums.length >= 2) {
      p = multiChapterComparisonPlan(p.ragQuery || message, nums, agentConfig);
    }
  } else if (asksKnowledge && !asksRubric && !asksConfig) {
    p = knowledgeOnlyPlan(p.ragQuery || message, p.pageNumber, p.chapterNumber, agentConfig);
    if (asksProject && input.hasProjectData) {
      p.sources = ["knowledge_rag", "project", "project_structured"];
      p.excludeSources = ["rubric", "report_format", "config_summary"];
      p.agentLevel = "B";
      p.complexity = "moderate";
      p.useToolLoop = true;
      p.intent = "mixed";
      p.intentLabel = "Manual y proyecto";
      p.toolsHint = ["search_knowledge", "get_project_elements"];
    }
  }

  if (asksRubric) {
    p.sources = [...new Set([...p.sources, "rubric"])] as ContextPlan["sources"];
    p.excludeSources = p.excludeSources.filter((s) => s !== "rubric");
  }

  if (asksRubric && asksKnowledge) {
    p.sources = [...new Set([...p.sources, "knowledge_rag", "rubric"])] as ContextPlan["sources"];
    p.excludeSources = p.excludeSources.filter(
      (s) => s !== "rubric" && s !== "knowledge_rag"
    );
    p.agentLevel = "C";
    p.complexity = "complex";
    p.useToolLoop = true;
    p.intent = "mixed";
    p.intentLabel = "Evaluación de rúbrica según manual";
    p.toolsHint = [...new Set([...p.toolsHint, "search_knowledge", "get_rubric"])];
    p.responseRules = [
      "Responde en español evaluando si la rúbrica está bien formulada según el manual de referencia.",
      "DEBES usar el texto de la rúbrica configurada y los fragmentos del Knowledge en tu respuesta.",
      "Indica fortalezas, debilidades y recomendaciones concretas de mejora.",
    ];
  } else if (asksRubric && !asksKnowledge) {
    p.sources = [...new Set([...p.sources, "config_summary"])] as ContextPlan["sources"];
  }

  if (asksConfig && !asksKnowledge && !asksProject) {
    p = { ...configOnlyPlan(), ...p, sources: configOnlyPlan().sources };
  }

  const comparesMultiple =
    (asksKnowledge && asksProject) ||
    (asksKnowledge && asksRubric) ||
    /\bcompar(a|ar|ación)\b/i.test(m) ||
    /\bseg[uú]n\s+el\s+manual\b.*\bproyecto\b/i.test(m) ||
    /\bmanual\b.*\by\b.*\bproyecto\b/i.test(m);

  if (comparesMultiple) {
    if (multiChapter && asksKnowledge && chapterNumbers.length >= 2) {
      p = multiChapterComparisonPlan(p.ragQuery || message, chapterNumbers, agentConfig);
    } else {
      p.agentLevel = "C";
      p.complexity = "complex";
      p.useToolLoop = true;
      p.toolsHint = ["search_knowledge", "get_project_elements", "get_rubric", "get_config"];
    }
  } else if (p.useToolLoop && p.agentLevel === "A") {
    p.agentLevel = "B";
    p.complexity = "moderate";
  }

  if (!input.hasProjectData) {
    p.sources = p.sources.filter((s) => s !== "project" && s !== "project_structured");
  }
  if (!input.hasRubric) {
    p.sources = p.sources.filter((s) => s !== "rubric");
  }
  if (!input.hasKnowledge) {
    p.sources = p.sources.filter((s) => s !== "knowledge_rag");
  }

  return validateAndNormalizePlan(p, configOnlyPlan());
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
      : classifyChatIntent(input.message, input.hasProjectData);
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
