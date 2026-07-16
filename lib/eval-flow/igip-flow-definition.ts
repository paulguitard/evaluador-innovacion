export type FlowConfigActionId =
  | "elements-list"
  | "extract-basic"
  | "extract-advanced"
  | "knowledge-docs"
  | "rag-config"
  | "rubric"
  | "eval-general"
  | "eval-orientation"
  | "eval-prompts"
  | "eval-rag"
  | "eval-limits"
  | "report-structure"
  | "report-prompts"
  | "report-tokens";

export type FlowConfigAction = {
  id: FlowConfigActionId;
  label: string;
};

export type IgipFlowStep = {
  id: string;
  order: number;
  title: string;
  description: string;
  branch?: boolean;
  branchTarget?: string;
  actions: FlowConfigAction[];
  readOnly?: boolean;
};

export const FLOW_ACTION_LABELS: Record<FlowConfigActionId, string> = {
  "elements-list": "Elementos a identificar",
  "extract-basic": "Parámetros de extracción",
  "extract-advanced": "Extracción avanzada",
  "knowledge-docs": "Documentos de referencia",
  "rag-config": "Configuración RAG",
  rubric: "Rúbrica y ponderaciones",
  "eval-general": "Parámetros generales",
  "eval-orientation": "Texto opcional (evaluación)",
  "eval-prompts": "Prompts de evaluación",
  "eval-rag": "RAG en evaluación",
  "eval-limits": "Límites y tokens",
  "report-structure": "Estructura del informe",
  "report-prompts": "Prompts de formateo",
  "report-tokens": "Tokens formateo",
};

export function getFlowActionLabel(id: FlowConfigActionId): string {
  return FLOW_ACTION_LABELS[id];
}

export const IGIP_FLOW_STEPS: IgipFlowStep[] = [
  {
    id: "extract",
    order: 1,
    title: "Extracción del proyecto",
    description:
      "Indexa los documentos del proyecto y extrae cada elemento definido (Excel, PDF, etc.) mediante heurísticas y agente LLM.",
    actions: [
      { id: "elements-list", label: FLOW_ACTION_LABELS["elements-list"] },
      { id: "extract-basic", label: FLOW_ACTION_LABELS["extract-basic"] },
      { id: "extract-advanced", label: FLOW_ACTION_LABELS["extract-advanced"] },
    ],
  },
  {
    id: "knowledge",
    order: 2,
    title: "Base de conocimiento",
    description:
      "Documentación de referencia indexada en RAG. Se consulta durante la evaluación por subdimensión, no en la extracción.",
    branch: true,
    branchTarget: "evaluate",
    actions: [
      { id: "knowledge-docs", label: FLOW_ACTION_LABELS["knowledge-docs"] },
      { id: "rag-config", label: FLOW_ACTION_LABELS["rag-config"] },
    ],
  },
  {
    id: "rubric",
    order: 3,
    title: "Rúbrica IGIP",
    description:
      "Define dimensiones, subdimensiones, ponderaciones y escala de notas (1–4) que estructuran la evaluación.",
    actions: [{ id: "rubric", label: FLOW_ACTION_LABELS.rubric }],
  },
  {
    id: "evaluate",
    order: 4,
    title: "Evaluación por subdimensión",
    description:
      "Por cada subdimensión: consulta RAG (knowledge + proyecto), genera análisis con nota, justificación y mejoras.",
    actions: [
      { id: "eval-general", label: FLOW_ACTION_LABELS["eval-general"] },
      { id: "eval-orientation", label: FLOW_ACTION_LABELS["eval-orientation"] },
      { id: "eval-prompts", label: FLOW_ACTION_LABELS["eval-prompts"] },
      { id: "eval-rag", label: FLOW_ACTION_LABELS["eval-rag"] },
      { id: "eval-limits", label: FLOW_ACTION_LABELS["eval-limits"] },
    ],
  },
  {
    id: "report",
    order: 5,
    title: "Ensamblado del informe",
    description:
      "Redacta resúmenes por dimensión, integra evaluaciones de subdimensión, síntesis final y bloque de notas.",
    actions: [
      { id: "report-structure", label: FLOW_ACTION_LABELS["report-structure"] },
      { id: "report-prompts", label: FLOW_ACTION_LABELS["report-prompts"] },
      { id: "report-tokens", label: FLOW_ACTION_LABELS["report-tokens"] },
    ],
  },
  {
    id: "scores",
    order: 6,
    title: "Notas e índice IGIP",
    description:
      "Bloque autoritativo generado automáticamente con notas por subdimensión e índice ponderado. No requiere configuración.",
    readOnly: true,
    actions: [],
  },
];
