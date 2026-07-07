export type ChatAgentConfig = {
  routerSystemPrompt: string;
  knowledgeResponseRules: string[];
  multiChapterResponseRules: string[];
  contextHardRules: {
    knowledgeOnlyNoRubric: string;
    chapterComparisonNoRubric: string;
    buildContextNoRubric: string;
  };
  defaultKnowledgeQuerySuffix: string;
};

export const DEFAULT_ROUTER_SYSTEM_PROMPT = `Eres un agente planificador de contexto para un evaluador de proyectos de innovación.
Tu única tarea es analizar la pregunta del usuario y devolver un JSON con el plan de qué fuentes incluir en el system prompt.

Fuentes disponibles (sources):
- config_summary: resumen de configuración (metodología programada, formato, elementos, estado rúbrica)
- report_format: formato del informe
- rubric: rúbrica y criterios de evaluación
- project: elementos extraídos del proyecto
- project_structured: datos Excel estructurados
- knowledge_rag: fragmentos del manual de referencia (Knowledge)

Reglas:
- Si preguntan por el manual, knowledge, Oslo, innovación teórica, definiciones → sources SOLO knowledge_rag (o knowledge_rag + project si comparan). excludeSources debe incluir rubric, report_format, config_summary salvo que también pregunten por ellos.
- Si preguntan por el proyecto (objetivos, presupuesto, sedes…) → project (+ project_structured si hay Excel). excludeSources: rubric, knowledge_rag salvo que también lo pidan.
- Si preguntan por configuración, formato, elementos, rúbrica configurada → config sources. excludeSources: knowledge_rag, project.
- Si preguntan por la rúbrica Y el manual/Oslo (evaluar la rúbrica según el manual) → sources knowledge_rag + rubric; NO excluir rubric; agentLevel C, useToolLoop true.
- Si comparan manual Y proyecto O necesitan varias fuentes → complexity "moderate" o "complex", agentLevel "B" o "C", useToolLoop true.
- Pregunta simple de una sola fuente → agentLevel "A", complexity "simple", useToolLoop false.
- Comparación, varios pasos, "según el manual y el proyecto" → agentLevel "C", complexity "complex", useToolLoop true.
- Pregunta que requiere buscar en manual Y leer proyecto pero en un paso → agentLevel "B", complexity "moderate", useToolLoop true.

Responde ÚNICAMENTE con JSON válido (sin markdown):
{
  "agentLevel": "A" | "B" | "C",
  "complexity": "simple" | "moderate" | "complex",
  "intent": "knowledge" | "project" | "config" | "mixed",
  "intentLabel": "texto corto en español",
  "sources": ["..."],
  "excludeSources": ["..."],
  "ragMode": "chat-knowledge" | "chat-project" | "chat-config" | "chat-chapter",
  "ragQuery": "consulta para búsqueda RAG si aplica",
  "reasoning": "1-2 frases en español",
  "responseRules": ["regla 1", "regla 2"],
  "useToolLoop": false,
  "toolsHint": ["search_knowledge", "get_project_elements"]
}`;

export function defaultChatAgentConfig(): ChatAgentConfig {
  return {
    routerSystemPrompt: DEFAULT_ROUTER_SYSTEM_PROMPT,
    knowledgeResponseRules: [
      "Responde ÚNICAMENTE con información de los fragmentos del Knowledge.",
      "PROHIBIDO usar la rúbrica de evaluación ni criterios de evaluación del proyecto.",
    ],
    multiChapterResponseRules: [
      "Responde en español con una COMPARACIÓN estructurada, no un resumen sección por sección de un solo capítulo.",
      "Usa solo los fragmentos del Knowledge. PROHIBIDO usar la rúbrica de evaluación.",
      "Si un capítulo no tiene fragmentos en el contexto, indícalo sin inventar.",
    ],
    contextHardRules: {
      knowledgeOnlyNoRubric:
        "PROHIBIDO usar la rúbrica de evaluación ni criterios de evaluación del proyecto.",
      chapterComparisonNoRubric: "PROHIBIDO usar la rúbrica de evaluación.",
      buildContextNoRubric:
        "REGLA: Responde ÚNICAMENTE describiendo o citando el texto de los fragmentos siguientes. No uses la rúbrica de evaluación del proyecto. No inventes contenido.",
    },
    defaultKnowledgeQuerySuffix: "Oslo Manual innovation",
  };
}

export function mergeChatAgentConfig(raw: Partial<ChatAgentConfig> | null | undefined): ChatAgentConfig {
  const base = defaultChatAgentConfig();
  if (!raw || typeof raw !== "object") return base;
  return {
    routerSystemPrompt:
      typeof raw.routerSystemPrompt === "string" && raw.routerSystemPrompt.trim()
        ? raw.routerSystemPrompt
        : base.routerSystemPrompt,
    knowledgeResponseRules: Array.isArray(raw.knowledgeResponseRules)
      ? raw.knowledgeResponseRules.filter((r): r is string => typeof r === "string")
      : base.knowledgeResponseRules,
    multiChapterResponseRules: Array.isArray(raw.multiChapterResponseRules)
      ? raw.multiChapterResponseRules.filter((r): r is string => typeof r === "string")
      : base.multiChapterResponseRules,
    contextHardRules: {
      knowledgeOnlyNoRubric:
        typeof raw.contextHardRules?.knowledgeOnlyNoRubric === "string"
          ? raw.contextHardRules.knowledgeOnlyNoRubric
          : base.contextHardRules.knowledgeOnlyNoRubric,
      chapterComparisonNoRubric:
        typeof raw.contextHardRules?.chapterComparisonNoRubric === "string"
          ? raw.contextHardRules.chapterComparisonNoRubric
          : base.contextHardRules.chapterComparisonNoRubric,
      buildContextNoRubric:
        typeof raw.contextHardRules?.buildContextNoRubric === "string"
          ? raw.contextHardRules.buildContextNoRubric
          : base.contextHardRules.buildContextNoRubric,
    },
    defaultKnowledgeQuerySuffix:
      typeof raw.defaultKnowledgeQuerySuffix === "string"
        ? raw.defaultKnowledgeQuerySuffix
        : base.defaultKnowledgeQuerySuffix,
  };
}
