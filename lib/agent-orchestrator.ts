import { getConfig } from "@/lib/db";
import { buildSystemContext, type ProjectStructuredData } from "@/lib/build-context";
import { streamChatDetailed, chatCompletionWithTools } from "@/lib/openrouter";
import { routeContextPlan, planSourcesSummary } from "@/lib/context-router";
import type { ContextPlan } from "@/lib/context-plan";
import { includesSource } from "@/lib/context-plan";
import type { ChatStreamEvent } from "@/lib/agent-events";
import { hasActiveKnowledgeIndex, isKnowledgeConfigured } from "@/lib/knowledge-config";
import {
  AGENT_TOOL_DEFINITIONS,
  createEmptyArtifacts,
  executeAgentTool,
  runPlannedTools,
  type AgentArtifacts,
  type AgentToolContext,
} from "@/lib/agent-tools";

export type ChatAgentInput = {
  evaluationTypeId: number;
  message: string;
  sessionId?: string;
  projectFilePaths: string[];
  projectElementsTable?: { element: string; content: string }[];
  projectStructuredData?: ProjectStructuredData;
  /** Resultados de evaluación masiva (informes y notas) para preguntas post-evaluación. */
  bulkEvaluationContext?: string;
  history: { role: "user" | "assistant"; content: string }[];
  /** Fragmentos RAG recuperados en el cliente (evita descarga Blob en servidor). */
  precomputedKnowledgeChunks?: import("@/lib/chunk-types").RetrievedChunk[];
  clientRagEnabled?: boolean;
};

const MAX_ITER_B = 4;
const MAX_ITER_C = 8;

const TOOL_LOOP_SYSTEM = `Eres un agente recopilador de contexto para un evaluador de proyectos de innovación.
Llama herramientas para reunir información. Cuando tengas suficiente, responde con un mensaje que empiece por LISTO: y un breve resumen.
No respondas a la pregunta del usuario todavía.`;

function buildResponseRules(
  plan: ContextPlan,
  hasRubric: boolean,
  rubricInContext: boolean
): string {
  let parts = [...plan.responseRules];
  if (rubricInContext) {
    parts = parts.filter((r) => !/PROHIBIDO.*r[uú]brica/i.test(r));
  }
  if (!hasRubric && plan.sources.includes("rubric")) {
    parts.push(
      "No hay rúbrica configurada. Si preguntan por criterios de evaluación, indícalo."
    );
  }
  return parts.map((r) => r.trim()).filter(Boolean).join("\n\n");
}

async function* runToolLoop(
  plan: ContextPlan,
  input: ChatAgentInput,
  artifacts: AgentArtifacts
): AsyncGenerator<ChatStreamEvent> {
  const maxIter = plan.agentLevel === "C" ? MAX_ITER_C : MAX_ITER_B;
  const ctx: AgentToolContext = {
    evaluationTypeId: input.evaluationTypeId,
    plan,
    sessionId: input.sessionId ?? "default",
    projectFilePaths: input.projectFilePaths,
    projectElementsTable: input.projectElementsTable,
    projectStructuredData: input.projectStructuredData,
  };

  yield {
    type: "step",
    phase: "agent",
    message: `Agente nivel ${plan.agentLevel}: recopilación con herramientas (hasta ${maxIter} pasos)…`,
  };

  const messages: Parameters<typeof chatCompletionWithTools>[0] = [
    { role: "system", content: TOOL_LOOP_SYSTEM },
    {
      role: "user",
      content: `Pregunta: ${input.message}\n\nPlan:\n${planSourcesSummary(plan)}\n\nHerramientas sugeridas: ${plan.toolsHint.join(", ") || "las necesarias"}`,
    },
  ];

  let usedNativeTools = false;

  for (let i = 0; i < maxIter; i++) {
    yield {
      type: "step",
      phase: "agent",
      message: `Agente nivel ${plan.agentLevel}: iteración ${i + 1}/${maxIter}…`,
    };

    try {
      const { content, toolCalls } = await chatCompletionWithTools(
        messages,
        AGENT_TOOL_DEFINITIONS,
        { max_tokens: 1024, temperature: 0.2, useCase: "agent" }
      );

      if (toolCalls.length > 0) {
        usedNativeTools = true;
        messages.push({
          role: "assistant",
          content: content ?? null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        for (const tc of toolCalls) {
          yield { type: "tool_call", tool: tc.name, arguments: tc.arguments };
          const result = await executeAgentTool(tc.name, tc.arguments, ctx, artifacts);
          yield { type: "tool_result", tool: tc.name, summary: result.summary };
          messages.push({ role: "tool", tool_call_id: tc.id, content: result.summary });
        }
        continue;
      }

      if (content?.trim().toUpperCase().startsWith("LISTO:")) {
        yield {
          type: "step",
          phase: "agent",
          message: content.trim().slice(0, 220),
        };
        break;
      }

      if (plan.agentLevel === "C" && i < maxIter - 1) {
        messages.push({ role: "assistant", content: content ?? "Continuando." });
        messages.push({
          role: "user",
          content:
            "Si falta información, llama más herramientas. Si es suficiente, responde LISTO: con resumen.",
        });
        continue;
      }
      break;
    } catch {
      break;
    }
  }

  if (!usedNativeTools || artifacts.toolLog.length === 0) {
    yield {
      type: "step",
      phase: "agent",
      message: "Ejecutando herramientas del plan (respaldo)…",
    };
    const before = artifacts.toolLog.length;
    await runPlannedTools(ctx, artifacts);
    for (const entry of artifacts.toolLog.slice(before)) {
      yield { type: "tool_result", tool: entry.tool, summary: entry.summary };
    }
  }
}

export async function* runChatAgent(input: ChatAgentInput): AsyncGenerator<ChatStreamEvent> {
  const config = await getConfig(input.evaluationTypeId);
  const hasRubric = !!((config?.rubric_prompt ?? "").trim());
  const hasBulkEvalData = !!(input.bulkEvaluationContext?.trim());
  const hasProjectData = !!(
    input.projectElementsTable?.length ||
    input.projectStructuredData?.files?.length ||
    hasBulkEvalData
  );
  const hasKnowledge =
    (await isKnowledgeConfigured(input.evaluationTypeId)) &&
    (await hasActiveKnowledgeIndex(input.evaluationTypeId));

  yield {
    type: "step",
    phase: "intent",
    message: "Agente planificador (Nivel A): analizando la pregunta…",
  };

  let plan = await routeContextPlan({
    message: input.message,
    hasProjectData,
    hasRubric,
    hasKnowledge,
  });

  const artifacts = createEmptyArtifacts();
  if (input.precomputedKnowledgeChunks?.length) {
    artifacts.knowledgeChunks = input.precomputedKnowledgeChunks;
  }

  if (
    input.clientRagEnabled &&
    artifacts.knowledgeChunks.length > 0 &&
    plan.intent === "knowledge"
  ) {
    plan = {
      ...plan,
      useToolLoop: false,
      agentLevel: "A",
      toolsHint: plan.toolsHint.filter((t) => t !== "search_knowledge"),
    };
  }

  const hasEmptyElements = (input.projectElementsTable ?? []).some((r) => !r.content.trim());
  const wantsReextract =
    /re-?extra|vuelve a extra|completar extracción|elemento vacío/i.test(input.message);
  if (
    (hasEmptyElements || wantsReextract) &&
    plan.sources.includes("project") &&
    (input.projectFilePaths?.length ?? 0) > 0 &&
    !plan.toolsHint.includes("reextract_project_element")
  ) {
    plan = {
      ...plan,
      toolsHint: [...plan.toolsHint, "reextract_project_element"],
      useToolLoop: plan.useToolLoop || wantsReextract,
      agentLevel: wantsReextract && plan.agentLevel === "A" ? "B" : plan.agentLevel,
    };
  }

  yield {
    type: "plan",
    agentLevel: plan.agentLevel,
    complexity: plan.complexity,
    intent: plan.intent,
    label: plan.intentLabel,
    sources: plan.sources,
    excludeSources: plan.excludeSources,
    reasoning: plan.reasoning,
    summary: planSourcesSummary(plan),
  };

  yield {
    type: "intent",
    intent: plan.intent,
    contextMode: plan.ragMode,
    label: plan.intentLabel,
  };

  const initialElementsKey = JSON.stringify(input.projectElementsTable ?? []);

  if (plan.useToolLoop && (plan.agentLevel === "B" || plan.agentLevel === "C")) {
    yield* runToolLoop(plan, input, artifacts);
  }

  const updatedElementsKey = JSON.stringify(
    artifacts.projectElements.length > 0 ? artifacts.projectElements : (input.projectElementsTable ?? [])
  );
  if (artifacts.projectElements.length > 0 && updatedElementsKey !== initialElementsKey) {
    yield { type: "project_elements_updated", elements: artifacts.projectElements };
  }

  const skipKnowledgeInBuild =
    !plan.sources.includes("knowledge_rag") ||
    (artifacts.knowledgeChunks.length > 0 &&
      plan.useToolLoop &&
      !plan.comparisonMode);

  const contextEvents: ChatStreamEvent[] = [];
  const systemContent = await buildSystemContext(input.evaluationTypeId, input.projectFilePaths, {
    projectElementsTable: input.projectElementsTable?.length
      ? input.projectElementsTable
      : undefined,
    projectStructuredData: input.projectStructuredData,
    skipKnowledge: skipKnowledgeInBuild,
    projectElementsOnly: true,
    contextMode: plan.ragMode,
    ragQuery: plan.ragQuery || input.message,
    pageNumber: plan.pageNumber,
    chapterNumber: plan.comparisonMode ? undefined : plan.chapterNumber,
    chapterNumbers: plan.chapterNumbers,
    contextPlan: plan,
    agentArtifacts: artifacts,
    onStreamEvent: (event) => contextEvents.push(event),
  });

  for (const e of contextEvents) yield e;

  const rubricInContext =
    hasRubric &&
    (includesSource(plan, "rubric") || !!artifacts.rubricText?.trim());

  const languageInstruction =
    "Responde siempre en español. Todas tus respuestas deben estar escritas íntegramente en español.\n\n";
  const baseInstruction =
    "Eres un asistente experto en evaluación de proyectos. Responde con claridad y basándote solo en el contexto proporcionado.\n\nREGLA OBLIGATORIA para objetivos: Si preguntan por el objetivo general o los objetivos específicos del proyecto, cita ÚNICAMENTE el texto de la sección del proyecto. No parafrasees.\n\nNo uses nunca las etiquetas <think> ni </think> en tus respuestas.";
  const rulesBlock = buildResponseRules(plan, hasRubric, rubricInContext);
  const bulkBlock = input.bulkEvaluationContext?.trim()
    ? `${input.bulkEvaluationContext.trim()}\n\n---\n\n`
    : "";
  const systemMessage =
    (rulesBlock ? `REGLAS DE RESPUESTA:\n${rulesBlock}\n\n---\n\n` : "") +
    languageInstruction +
    bulkBlock +
    (systemContent || baseInstruction);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemMessage },
    ...input.history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: input.message },
  ];

  yield {
    type: "step",
    phase: "llm",
    message: "Generando respuesta con el modelo de lenguaje…",
  };

  let hasThinking = false;
  let hasContent = false;

  for await (const part of streamChatDetailed(messages, { useCase: "chat" })) {
    if (part.kind === "thinking") {
      if (!hasThinking) {
        yield {
          type: "step",
          phase: "thinking",
          message: "El modelo está razonando antes de responder…",
        };
        hasThinking = true;
      }
      yield { type: "thinking", chunk: part.text };
    } else {
      if (!hasContent && part.text.trim()) {
        yield {
          type: "step",
          phase: "answer",
          message: "Redactando la respuesta final…",
        };
        hasContent = true;
      }
      yield { type: "content", chunk: part.text };
    }
  }

  yield { type: "done" };
}
