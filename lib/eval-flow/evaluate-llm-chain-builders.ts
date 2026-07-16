import type { FlowConfigActionId } from "./igip-flow-definition";
import type { EvaluateSystemAssemblyFlow } from "./evaluate-system-assembly-flow";
import {
  chainNode,
  type IgipPromptChainNode,
  type IgipPromptChainPart,
} from "./igip-prompt-chains-types";
import type { SystemPromptSource } from "@/lib/system-prompts-catalog";
import { applyPromptTemplate, formatOptionalPhaseInstructions } from "@/lib/eval-types/prompt-defaults";

export const EVALUATE_LLM_CHAIN_HINT =
  "Cada llamada al LLM envía exactamente 2 mensajes: SYSTEM y USER. El detalle interno del SYSTEM (RAG, secciones, regla de idioma…) está en «Mapa de ensamblado».";

const SYSTEM_MESSAGE_PARTS: IgipPromptChainPart[] = [
  {
    title: "Regla de idioma (español 100%)",
    description: "Antepuesta al contexto (código fijo)",
    source: "código",
  },
  {
    title: "Contexto de evaluación",
    description: "5 secciones en orden: config → enfoque → proyecto → RAG → rúbrica completa",
    source: "dinámico",
    configActionId: "eval-rag",
  },
  {
    title: "Sufijo anti-thinking",
    description: "Concatenado al final (código fijo)",
    source: "código",
  },
];

export function buildEvaluateSystemMessageNode(params: {
  order: number;
  systemPreview: string;
  assemblyFlow: EvaluateSystemAssemblyFlow;
  relatedConfigActionIds: FlowConfigActionId[];
}): IgipPromptChainNode {
  return chainNode(
    params.order,
    "system",
    "Mensaje SYSTEM",
    "Un solo mensaje enviado al LLM. La recuperación RAG ocurre al construir el contexto — no es un mensaje aparte.",
    params.systemPreview,
    "dinámico",
    undefined,
    params.relatedConfigActionIds,
    params.assemblyFlow,
    SYSTEM_MESSAGE_PARTS
  );
}

export function previewUserMessageWithOrientation(
  template: string,
  orientation: string,
  placeholders: Record<string, string>
): string {
  return applyPromptTemplate(template, {
    ...placeholders,
    phaseInstructions: formatOptionalPhaseInstructions(orientation),
  });
}

function optionalOrientationPart(orientation: string): IgipPromptChainPart | null {
  const trimmed = orientation.trim();
  if (!trimmed) return null;
  return {
    title: "Texto opcional ({{phaseInstructions}})",
    description: "Solo si configuraste orientación adicional en evaluación",
    source: "configuración",
    configActionId: "eval-orientation",
    content: trimmed,
  };
}

export function buildEvaluateUserMessageNode(params: {
  order: number;
  focusLabel: string;
  template: string;
  templateSource: SystemPromptSource;
  orientation: string;
  userPreview: string;
  extraParts?: IgipPromptChainPart[];
}): IgipPromptChainNode {
  const orientationPart = optionalOrientationPart(params.orientation);
  const parts: IgipPromptChainPart[] = [
    {
      title: `Plantilla evaluar ${params.focusLabel}`,
      description: "Única fuente de instrucciones por defecto (metodología, secciones, formato Nota/Nivel)",
      source: params.templateSource,
      configActionId: "eval-prompts",
      content: params.template,
    },
    ...(orientationPart ? [orientationPart] : []),
    ...(params.extraParts ?? []),
  ];

  const description = orientationPart
    ? `Plantilla de ${params.focusLabel} + texto opcional al final ({{phaseInstructions}}).`
    : `Plantilla de ${params.focusLabel} (sin texto opcional; {{phaseInstructions}} vacío).`;

  return chainNode(
    params.order,
    "user",
    "Mensaje USER",
    description,
    params.userPreview,
    params.templateSource,
    "eval-prompts",
    undefined,
    undefined,
    parts
  );
}

export function buildLlmUserMessageNode(params: {
  order: number;
  description: string;
  content: string;
  source: SystemPromptSource;
  configActionId?: FlowConfigActionId;
  parts: IgipPromptChainPart[];
}): IgipPromptChainNode {
  return chainNode(
    params.order,
    "user",
    "Mensaje USER",
    params.description,
    params.content,
    params.source,
    params.configActionId,
    undefined,
    undefined,
    params.parts
  );
}
