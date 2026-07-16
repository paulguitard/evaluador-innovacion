/** Metadatos compartidos del catálogo de system prompts (cliente y servidor). */

export type SystemPromptSource = "código" | "configuración" | "dinámico";

export type SystemPromptEntry = {
  id: string;
  title: string;
  description: string;
  content: string;
  source: SystemPromptSource;
  /** Dónde editarlo en la UI o en el código, si aplica. */
  editableIn?: string;
};

export type SystemPromptCategory = {
  id: string;
  title: string;
  description: string;
  prompts: SystemPromptEntry[];
};

export type SystemPromptsCatalogResponse = {
  generatedAt: string;
  categories: SystemPromptCategory[];
};

export function entry(
  id: string,
  title: string,
  description: string,
  content: string,
  source: SystemPromptSource,
  editableIn?: string
): SystemPromptEntry {
  return { id, title, description, content, source, editableIn };
}

/** Bucle tool-calling del chat (Nivel B/C). */
export const CHAT_TOOL_LOOP_SYSTEM_PROMPT = `Eres un agente recopilador de contexto para un evaluador de proyectos de innovación.
Llama herramientas para reunir información. Cuando tengas suficiente, responde con un mensaje que empiece por LISTO: y un breve resumen.
No respondas a la pregunta del usuario todavía.`;

/** Agente de extracción legacy (project-extract-agent). */
export const LEGACY_AGENT_EXTRACT_SYSTEM_PROMPT = `Eres un agente de extracción para documentos de proyecto de innovación.

Recibes fragmentos de uno o más archivos y debes extraer el contenido de UN elemento concreto.

Reglas:
- Transcribe el contenido exactamente, sin resumir ni omitir.
- Si el contenido está repartido en varios fragmentos, combínalo en orden lógico.
- Si no encuentras el elemento, devuelve content vacío.
- Responde ÚNICAMENTE JSON: {"content":"..."}`;

export const CHAT_RESPONSE_BASE_INSTRUCTION = `Eres un asistente experto en evaluación de proyectos. Responde con claridad y basándote solo en el contexto proporcionado.

REGLA OBLIGATORIA para objetivos: Si preguntan por el objetivo general o los objetivos específicos del proyecto, cita ÚNICAMENTE el texto de la sección del proyecto. No parafrasees.

No uses nunca las etiquetas <think> ni </think> en tus respuestas.`;

export const CHAT_RESPONSE_LANGUAGE_PREFIX =
  "Responde siempre en español. Todas tus respuestas deben estar escritas íntegramente en español.\n\n";

/** Regla de idioma para evaluación e informes (system message completo). */
export const EVALUATION_RESPONSE_LANGUAGE_RULE =
  "Responde siempre íntegramente en español. Aunque el contexto de Knowledge, la documentación de referencia o fragmentos del proyecto estén en inglés u otro idioma, toda tu evaluación e informe deben estar escritos al 100% en español. Traduce conceptos técnicos si es necesario; no copies ni cites fragmentos en inglés.";

/** Viñeta reutilizable en prompts de formateo de secciones e informe. */
export const EVALUATION_REPORT_LANGUAGE_BULLET =
  "Redacta íntegramente en español (100%). Si el material fuente está en inglés u otro idioma, traduce sin copiar fragmentos en ese idioma.";

export const EVALUATION_SYSTEM_SUFFIX =
  "\n\nResponde solo con el análisis. No uses etiquetas <think>.";

/** Ensambla el system message estándar de pasos de evaluación LLM. */
export function buildEvaluationSystemMessage(
  systemContent: string,
  fallback?: string
): string {
  const base = systemContent.trim() || fallback?.trim() || "";
  return `${EVALUATION_RESPONSE_LANGUAGE_RULE}\n\n${base}${EVALUATION_SYSTEM_SUFFIX}`;
}

export const SCORES_JSON_RETRY_SYSTEM_PROMPT = (label: string) =>
  `Completa el JSON de notas ${label}. Responde SOLO JSON válido con TODAS las claves en subdimensionScores.`;

export const FALLBACK_SUMMARY_SYSTEM_PROMPT = (indicatorLabel: string) =>
  `Eres evaluador ${indicatorLabel}. Escribes síntesis evaluativas concisas. NUNCA describas el proyecto, sus objetivos ni actividades. Solo veredicto evaluativo. ${EVALUATION_RESPONSE_LANGUAGE_RULE}`;

export const BUILD_SYSTEM_CONTEXT_DESCRIPTION = `No es un texto fijo: se ensambla en runtime con buildSystemContext() según el modo (chat, evaluación, etc.).

Puede incluir, según el plan o la fase:
- Fragmentos RAG del Knowledge (manual Oslo, documentación de referencia)
- Rúbrica y criterios de evaluación
- Formato del informe configurado
- Elementos extraídos del proyecto y datos Excel estructurados
- Resumen de configuración (metodología, elementos, estado)
- Reglas duras del agente (p. ej. prohibición de usar rúbrica en modo solo Knowledge)
- En evaluación por subdimensión: enfoque en la subdimensión activa

En evaluación IGIP/IMET, el contexto ensamblado debe estar completo; si falta alguna sección o supera maxSystemChars, la evaluación falla con error explícito (sin fallback).`;
