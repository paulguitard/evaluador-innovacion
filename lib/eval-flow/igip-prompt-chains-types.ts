import type { FlowConfigActionId } from "./igip-flow-definition";
import type { ReportAssemblySequenceStep } from "./report-assembly-sequence";
import type { SystemPromptSource } from "@/lib/system-prompts-catalog";
import type { EvaluateSystemAssemblyFlow } from "./evaluate-system-assembly-flow";

export type PromptChainNodeType = "system" | "user" | "tools" | "context" | "output";

/** Parte interna de un mensaje LLM (no es un nodo independiente de la cadena). */
export type IgipPromptChainPart = {
  title: string;
  description?: string;
  source?: SystemPromptSource;
  configActionId?: FlowConfigActionId;
  /** Vista previa opcional del texto de esta parte. */
  content?: string;
};

export type IgipPromptChainNode = {
  order: number;
  type: PromptChainNodeType;
  title: string;
  description: string;
  /** Vista previa corta para la tarjeta colapsada. */
  content: string;
  /** Texto completo; si falta, usar content. */
  fullContent?: string;
  source: SystemPromptSource;
  configActionId?: FlowConfigActionId;
  /** Para prompts dinámicos: secciones de la UI que alimentan el ensamblado. */
  relatedConfigActionIds?: FlowConfigActionId[];
  /** Mapa de ensamblado paso a paso (system contexto de evaluación). */
  assemblyFlow?: EvaluateSystemAssemblyFlow;
  /** Desglose interno del mensaje (p. ej. regla idioma + contexto + sufijo dentro de SYSTEM). */
  parts?: IgipPromptChainPart[];
  truncated?: boolean;
};

export type IgipPromptChain = {
  id: string;
  title: string;
  repeatLabel?: string;
  /** Nota contextual sobre la cadena (p. ej. «2 mensajes por llamada LLM»). */
  hint?: string;
  nodes: IgipPromptChainNode[];
};

export type { ReportAssemblySequenceStep };

export type IgipFlowStepPrompts = {
  stepId: string;
  chains: IgipPromptChain[];
  /** Orden real de ensamblado (solo paso report). */
  assemblySequence?: ReportAssemblySequenceStep[];
};

export type IgipFlowPromptChainsResponse = {
  generatedAt: string;
  evaluationTypeId: number;
  steps: IgipFlowStepPrompts[];
};

const PREVIEW_MAX = 520;

export function truncatePreview(text: string, max = PREVIEW_MAX): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };
  return { text: `${trimmed.slice(0, max)}…`, truncated: true };
}

export function chainNode(
  order: number,
  type: PromptChainNodeType,
  title: string,
  description: string,
  content: string,
  source: SystemPromptSource,
  configActionId?: FlowConfigActionId,
  relatedConfigActionIds?: FlowConfigActionId[],
  assemblyFlow?: EvaluateSystemAssemblyFlow,
  parts?: IgipPromptChainPart[]
): IgipPromptChainNode {
  const trimmed = content.trim() || "(vacío)";
  const { text, truncated } = truncatePreview(trimmed);
  return {
    order,
    type,
    title,
    description,
    content: text,
    fullContent: trimmed,
    source,
    configActionId:
      relatedConfigActionIds?.length || assemblyFlow || parts?.length ? undefined : configActionId,
    relatedConfigActionIds,
    assemblyFlow,
    parts,
    truncated,
  };
}
