import type { FlowConfigActionId } from "./igip-flow-definition";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  EVALUATION_RESPONSE_LANGUAGE_RULE,
  EVALUATION_SYSTEM_SUFFIX,
} from "@/lib/system-prompts-catalog";

/** Acciones de configuración que alimentan el system dinámico de evaluación. */
export const EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS: FlowConfigActionId[] = [
  "eval-general",
  "elements-list",
  "eval-rag",
  "knowledge-docs",
  "rubric",
  "eval-prompts",
  "eval-limits",
];

export type EvaluateSystemStructureParams = {
  /** Etiqueta del criterio activo: «subdimensión», «variable», etc. */
  focusLabel: string;
  /** Ejemplo del bloque «Enfoque de esta evaluación parcial» con el primer criterio. */
  focusSnippet: string;
  knowledgeLabel: string;
  projectElementsInRagQuery: number;
  ragEvaluate: EvaluationConfig["ragEvaluate"];
};

function formatRagParams(ragEvaluate: EvaluationConfig["ragEvaluate"]): string {
  const parts: string[] = [];
  parts.push(ragEvaluate.topK != null ? `topK=${ragEvaluate.topK}` : "topK=default");
  parts.push(
    ragEvaluate.maxRetrievedChars != null
      ? `maxRetrievedChars=${ragEvaluate.maxRetrievedChars}`
      : "maxRetrievedChars=default"
  );
  parts.push(
    ragEvaluate.maxSystemChars != null
      ? `maxSystemChars=${ragEvaluate.maxSystemChars}`
      : "maxSystemChars=default"
  );
  return parts.join(", ");
}

/** Documentación legible de cómo se compone el system dinámico en evaluación. */
export function buildEvaluateSystemStructureDoc(params: EvaluateSystemStructureParams): string {
  const ragParams = formatRagParams(params.ragEvaluate);

  return `COMPOSICIÓN DEL SYSTEM MESSAGE (evaluación por ${params.focusLabel})
══════════════════════════════════════════════════════════════

El system message final que recibe el LLM es (buildStrictEvaluationSystemMessage):

  [REGLA DE IDIOMA — lib/system-prompts-catalog.ts]
  ${EVALUATION_RESPONSE_LANGUAGE_RULE}

  +

  [CONTEXTO — buildSystemContext validado; error si incompleto o truncado]

  +

  [SUFIJO — lib/system-prompts-catalog.ts]
  ${EVALUATION_SYSTEM_SUFFIX.trim()}


SECCIONES OBLIGATORIAS (todas deben estar presentes y con contenido)
────────────────────────────────────────────────────────

1. ## Configuración actual de este tipo de evaluación
   Metodología del pipeline, elementos configurados y parámetros del tipo (sin criterios de rúbrica).

2. ## Enfoque de esta evaluación parcial
   Criterio activo (${params.focusLabel} en ejecución; ejemplo con el primero configurado):

${params.focusSnippet}

3. ## Documentos del proyecto a evaluar (elementos identificados)
   Tabla de elementos extraídos (título + contenido) del paso de extracción.

4. ## Documentación de referencia (Knowledge)
   Fragmentos RAG recuperados con query híbrida:
   - ${params.focusLabel} activa + hasta ${params.projectElementsInRagQuery} elementos del proyecto en la query
   - Parámetros RAG evaluate: ${ragParams}
   - Etiqueta de referencia: «${params.knowledgeLabel}»

5. ## Rúbrica y criterios de evaluación
   Texto compilado de toda la rúbrica (ponderaciones o niveles).

EXCLUIDO en modo evaluate:
- Formato del informe (excludeReportFormat: true)
- Archivos del proyecto en bruto (solo elementos ya extraídos)

Límite global: si el texto supera maxSystemChars, la evaluación falla (sin truncar).


SI EL CONTEXTO QUEDA INCOMPLETO TRAS REINTENTO
──────────────────────────────────────────────
La evaluación se aborta con error explícito. No hay fallback de system prompt.

PARTES CONFIGURABLES EN LA UI
─────────────────────────────
- Parámetros generales → etiqueta índice (IGIP/IMET) y etiqueta knowledge
- Elementos a identificar → lista de elementos del proyecto (aparece en resumen de metodología)
- RAG en evaluación → parámetros topK y límites de caracteres
- Documentos de referencia → archivos del Knowledge indexados
- Rúbrica → criterios y ejemplos por ${params.focusLabel}
- Prompts de evaluación → plantillas user de subdimensión/variable
- Límites y tokens → maxTokens por paso de evaluación

POLÍTICA ESTRICTA:
- Sin fallback de system prompt
- Sin truncado del contexto en evaluate
- Reintento RAG servidor si falla el primer ensamblado`;
}
