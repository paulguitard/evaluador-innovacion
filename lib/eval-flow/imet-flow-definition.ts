import type { FlowConfigAction, FlowConfigActionId, IgipFlowStep } from "./igip-flow-definition";
import { FLOW_ACTION_LABELS } from "./igip-flow-definition";

export type ImetFlowStep = IgipFlowStep;

const IMET_ACTION_LABELS: Partial<Record<FlowConfigActionId, string>> = {
  rubric: "Rúbrica y niveles",
};

function imetAction(id: FlowConfigActionId): FlowConfigAction {
  return { id, label: IMET_ACTION_LABELS[id] ?? FLOW_ACTION_LABELS[id] };
}

export const IMET_FLOW_STEPS: ImetFlowStep[] = [
  {
    id: "extract",
    order: 1,
    title: "Extracción del proyecto",
    description:
      "Indexa los documentos del proyecto y extrae cada elemento definido (Excel, PDF, etc.) mediante heurísticas y agente LLM.",
    actions: [
      imetAction("elements-list"),
      imetAction("extract-basic"),
      imetAction("extract-advanced"),
    ],
  },
  {
    id: "knowledge",
    order: 2,
    title: "Base de conocimiento",
    description:
      "Documentación de referencia indexada en RAG. Se consulta durante la evaluación por variable o nivel global, no en la extracción.",
    branch: true,
    branchTarget: "evaluate",
    actions: [imetAction("knowledge-docs"), imetAction("rag-config")],
  },
  {
    id: "rubric",
    order: 3,
    title: "Rúbrica IMET",
    description:
      "Define variables de evaluación, escala de niveles y criterios que estructuran la asignación de nivel del emprendimiento.",
    actions: [imetAction("rubric")],
  },
  {
    id: "evaluate",
    order: 4,
    title: "Evaluación por variables y nivel",
    description:
      "Por cada variable: consulta RAG (knowledge + proyecto) y genera análisis con nivel asignado. Luego determina el nivel global del proyecto.",
    actions: [
      imetAction("eval-general"),
      imetAction("eval-orientation"),
      imetAction("eval-prompts"),
      imetAction("eval-rag"),
      imetAction("eval-limits"),
    ],
  },
  {
    id: "report",
    order: 5,
    title: "Ensamblado del informe",
    description:
      "Redacta secciones según formato §6, integra evaluaciones por variable y síntesis evaluativa final con el nivel asignado.",
    actions: [
      imetAction("report-structure"),
      imetAction("report-prompts"),
      imetAction("report-tokens"),
    ],
  },
  {
    id: "level",
    order: 6,
    title: "Nivel asignado IMET",
    description:
      "Nivel global del emprendimiento determinado a partir de las variables evaluadas. No requiere configuración.",
    readOnly: true,
    actions: [],
  },
];
