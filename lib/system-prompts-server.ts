import "server-only";

import { loadChatAgentConfig } from "@/lib/chat-agent-config-server";
import { getConfig, getEvaluationTypes } from "@/lib/db";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET,
  DEFAULT_EVAL_SYSTEM_FALLBACK,
} from "@/lib/eval-types/prompt-defaults";
import {
  buildExtractTypeSpecificDefaults,
  DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP,
  DEFAULT_GANTT_STRUCTURE_PROMPT_IMET,
  DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP,
  DEFAULT_INDICATORS_STRUCTURE_PROMPT_IMET,
} from "@/lib/eval-types/extract-config-defaults";
import { mergeRubricConfig } from "@/lib/rubric-config";
import { mergeReportFormatConfig, buildFormatSystemPrompt } from "@/lib/report-format-config";
import {
  buildSectionFormatSystemPrompt,
  buildFinalSynthesisSystemPrompt,
  buildFinalSynthesisSystemPromptForLevels,
} from "@/lib/format-report-sections";
import { buildRubricScoreSchemaFromConfig } from "@/lib/rubric-config";
import { fixedKeyFor } from "@/lib/eval-types/constants";
import {
  BUILD_SYSTEM_CONTEXT_DESCRIPTION,
  CHAT_RESPONSE_BASE_INSTRUCTION,
  CHAT_RESPONSE_LANGUAGE_PREFIX,
  CHAT_TOOL_LOOP_SYSTEM_PROMPT,
  EVALUATION_RESPONSE_LANGUAGE_RULE,
  EVALUATION_SYSTEM_SUFFIX,
  entry,
  FALLBACK_SUMMARY_SYSTEM_PROMPT,
  LEGACY_AGENT_EXTRACT_SYSTEM_PROMPT,
  type SystemPromptCategory,
  type SystemPromptsCatalogResponse,
} from "@/lib/system-prompts-catalog";
import type { ReportSection } from "@/lib/report-format-config";

function exampleSection(
  partial: Pick<ReportSection, "kind" | "title" | "description" | "minChars" | "maxChars"> & {
    id?: string;
  }
): ReportSection {
  return {
    id: partial.id ?? "example-section",
    kind: partial.kind,
    title: partial.title,
    description: partial.description,
    minChars: partial.minChars,
    maxChars: partial.maxChars,
  };
}

async function loadTypeData(typeName: "IGIP" | "IMET") {
  const types = await getEvaluationTypes();
  const row = types.find((t) => fixedKeyFor(t.name) === typeName);
  if (!row) return null;

  const [config, typeSettings, evaluation] = await Promise.all([
    getConfig(row.id),
    getEvaluationTypeSettings(row.id),
    getEvaluationConfig(row.id),
  ]);

  let rubric = mergeRubricConfig(undefined, typeName);
  let reportFormat = mergeReportFormatConfig(undefined, rubric);
  if (config) {
    try {
      rubric = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"), typeName);
      reportFormat = mergeReportFormatConfig(
        JSON.parse(config.report_format_config || "{}"),
        rubric
      );
    } catch {
      /* defaults */
    }
  }

  const codeDefaults = buildExtractTypeSpecificDefaults(typeName);
  const extract = typeSettings.extract;

  return { typeName, typeSettings, evaluation, rubric, reportFormat, codeDefaults, extract };
}

export async function buildSystemPromptsCatalog(): Promise<SystemPromptsCatalogResponse> {
  const chatAgent = await loadChatAgentConfig();
  const [igip, imet] = await Promise.all([loadTypeData("IGIP"), loadTypeData("IMET")]);

  const categories: SystemPromptCategory[] = [];

  categories.push({
    id: "chat-global",
    title: "Chat y agente (global)",
    description: "Prompts del asistente y del router de contexto. Aplican a toda la aplicación.",
    prompts: [
      entry(
        "chat-router",
        "Router de contexto",
        "Planifica qué fuentes incluir en el system prompt del chat según la pregunta del usuario.",
        chatAgent.routerSystemPrompt,
        "configuración",
        "Configuración → Configurar agente → Router"
      ),
      entry(
        "chat-knowledge-rules",
        "Reglas respuesta Knowledge",
        "Reglas inyectadas cuando el plan es solo manual/Knowledge.",
        chatAgent.knowledgeResponseRules.join("\n"),
        "configuración",
        "Configuración → Configurar agente → Manual / Knowledge"
      ),
      entry(
        "chat-multi-chapter-rules",
        "Reglas comparación multi-capítulo",
        "Reglas para comparar capítulos del manual.",
        chatAgent.multiChapterResponseRules.join("\n"),
        "configuración",
        "Configuración → Configurar agente → Comparación multi-capítulo"
      ),
      entry(
        "chat-bulk-rules",
        "Reglas evaluación masiva",
        "Reglas para comparar proyectos evaluados, extracts e informes.",
        chatAgent.bulkResponseRules.join("\n"),
        "configuración",
        "Configuración → Configurar agente → Proyectos y evaluación masiva"
      ),
      entry(
        "chat-config-rules",
        "Reglas configuración del tipo",
        "Reglas para preguntas sobre formato, elementos o metodología configurada.",
        chatAgent.configResponseRules.join("\n"),
        "configuración",
        "Configuración → Configurar agente → Configuración del tipo"
      ),
      entry(
        "chat-project-rules",
        "Reglas datos de proyecto",
        "Reglas para citar extracts / elementos del proyecto.",
        chatAgent.projectResponseRules.join("\n"),
        "configuración",
        "Configuración → Configurar agente → Configuración del tipo"
      ),
      entry(
        "chat-tool-loop",
        "Agente recopilador (bucle de herramientas)",
        "System prompt del bucle tool-calling en niveles B/C del chat, antes de la respuesta final.",
        CHAT_TOOL_LOOP_SYSTEM_PROMPT,
        "código",
        "lib/system-prompts-catalog.ts"
      ),
      entry(
        "chat-response-base",
        "Instrucción base de respuesta del chat",
        "Fallback cuando buildSystemContext no devuelve contenido suficiente.",
        CHAT_RESPONSE_BASE_INSTRUCTION,
        "código",
        "lib/system-prompts-catalog.ts"
      ),
      entry(
        "chat-response-language",
        "Prefijo de idioma (español)",
        "Se antepone al system message final del chat.",
        CHAT_RESPONSE_LANGUAGE_PREFIX.trim(),
        "código",
        "lib/system-prompts-catalog.ts"
      ),
      entry(
        "chat-system-context",
        "Contexto system ensamblado (dinámico)",
        "Contenido variable que compone gran parte del system prompt en chat y evaluación.",
        BUILD_SYSTEM_CONTEXT_DESCRIPTION,
        "dinámico",
        "lib/build-context.ts"
      ),
      entry(
        "legacy-agent-extract",
        "Extracción legacy por agente",
        "Ruta alternativa de extracción con fragmentos RAG (project-extract-agent).",
        LEGACY_AGENT_EXTRACT_SYSTEM_PROMPT,
        "código",
        "lib/project-extract-agent.ts"
      ),
    ],
  });

  for (const bundle of [igip, imet].filter(Boolean)) {
    const { typeName, extract, evaluation, rubric, reportFormat } = bundle!;
    const label = typeName;

    categories.push({
      id: `extract-${typeName.toLowerCase()}`,
      title: `Extracción de elementos (${typeName})`,
      description: `System prompts del pipeline híbrido de extracción para evaluaciones ${typeName}.`,
      prompts: [
        entry(
          `extract-system-${typeName}`,
          "System prompt principal (LLM + tools)",
          "Rol del agente al extraer cada elemento del proyecto.",
          extract.prompts?.system?.trim() ||
            (typeName === "IMET"
              ? DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET
              : DEFAULT_EXTRACT_SYSTEM_PROMPT),
          extract.prompts?.system?.trim() ? "configuración" : "código",
          `Configuración → ${typeName} → Elementos → Estrategia de extracción`
        ),
        entry(
          `extract-gantt-structure-${typeName}`,
          "Estructura Gantt (system)",
          "Formatea la hoja Gantt/Cronograma. En runtime se añade la descripción del elemento.",
          (extract.structurePrompts.gantt?.trim() ||
            (typeName === "IMET"
              ? DEFAULT_GANTT_STRUCTURE_PROMPT_IMET
              : DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP)) +
            "\n\n[En runtime se añade la descripción del elemento configurado.]",
          extract.structurePrompts.gantt?.trim() ? "configuración" : "código",
          `Configuración → ${typeName} → Elementos → Patrones y prompts de estructura`
        ),
        entry(
          `extract-indicators-structure-${typeName}`,
          "Estructura Indicadores (system)",
          "Formatea la hoja de indicadores en bloques legibles.",
          extract.structurePrompts.indicators?.trim() ||
            (typeName === "IMET"
              ? DEFAULT_INDICATORS_STRUCTURE_PROMPT_IMET
              : DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP),
          extract.structurePrompts.indicators?.trim() ? "configuración" : "código",
          `Configuración → ${typeName} → Elementos → Patrones y prompts de estructura`
        ),
      ],
    });

    const evalPrompts = [
      entry(
        `eval-subdimension-system-${typeName}`,
        "Evaluación por subdimensión / variable (fallback)",
        "Fallback del system message si el contexto ensamblado está vacío; también base del mensaje en IMET.",
        evaluation.prompts.subdimensionSystem?.trim() || DEFAULT_EVAL_SYSTEM_FALLBACK,
        evaluation.prompts.subdimensionSystem?.trim() ? "configuración" : "código",
        `Configuración → ${typeName} → Evaluación`
      ),
      entry(
        `eval-format-system-${typeName}`,
        "Formateo de informe (override)",
        "Instrucciones extra de system al formatear el informe final (si está configurado).",
        evaluation.prompts.formatSystem?.trim() || "(no configurado — se usan las plantillas de informe en código)",
        evaluation.prompts.formatSystem?.trim() ? "configuración" : "código",
        `Configuración → ${typeName} → Evaluación`
      ),
      entry(
        `eval-language-rule-${typeName}`,
        "Regla de idioma (español 100%)",
        "Se antepone al system message en cada paso de evaluación e informe.",
        EVALUATION_RESPONSE_LANGUAGE_RULE,
        "código",
        "lib/evaluate-pipeline.ts, lib/evaluate-levels-pipeline.ts, lib/format-report-sections.ts"
      ),
      entry(
        `eval-system-suffix-${typeName}`,
        "Sufijo estándar de evaluación",
        "Se concatena al final del system message (vía buildEvaluationSystemMessage).",
        EVALUATION_SYSTEM_SUFFIX.trim(),
        "código",
        "lib/system-prompts-catalog.ts → buildEvaluationSystemMessage"
      ),
      entry(
        `eval-summary-fallback-${typeName}`,
        "Síntesis final (fallback)",
        "System prompt si falla la generación de síntesis por sección de informe.",
        FALLBACK_SUMMARY_SYSTEM_PROMPT(evaluation.indicatorLabel || label),
        "código",
        "lib/assemble-final-report.ts"
      ),
    ];

    categories.push({
      id: `evaluation-${typeName.toLowerCase()}`,
      title: `Evaluación (${typeName})`,
      description: `System prompts del pipeline de evaluación ${typeName}.`,
      prompts: evalPrompts,
    });

    const genericSection = exampleSection({
      kind: "subdimension_eval",
      title: "Subdimensión ejemplo",
      description: "Evaluación de una subdimensión",
      minChars: 1200,
      maxChars: 4000,
    });
    const resumenSection = exampleSection({
      kind: "custom",
      title: "Resumen del proyecto",
      description: "Síntesis narrativa del proyecto",
      minChars: 800,
      maxChars: 1500,
    });
    const dimensionSection = exampleSection({
      kind: "dimension_overview",
      title: "Dimensión: Ejemplo",
      description: "Resumen macro de la dimensión",
      minChars: 600,
      maxChars: 1200,
    });
    const synthesisSection = exampleSection({
      kind: "custom",
      title: "Síntesis final de la evaluación",
      description: "Conclusión global",
      minChars: 1000,
      maxChars: 2500,
    });

    const reportPrompts = [
      entry(
        `report-format-full-${typeName}`,
        "Formateo completo del informe",
        `Plantilla system para redactar todas las secciones del informe ${typeName} (ejemplo con rúbrica actual).`,
        buildFormatSystemPrompt(reportFormat, rubric),
        "dinámico",
        `Configuración → ${typeName} → Formato de informe + Rúbrica`
      ),
      entry(
        `report-section-generic-${typeName}`,
        "Sección genérica del informe",
        "Plantilla para una sección estándar (subdimensión, variable, etc.).",
        buildSectionFormatSystemPrompt(genericSection, rubric),
        "dinámico",
        "lib/format-report-sections.ts"
      ),
      entry(
        `report-section-resumen-${typeName}`,
        "Sección: Resumen del proyecto",
        "Plantilla system para la sección narrativa de resumen.",
        buildSectionFormatSystemPrompt(resumenSection, rubric),
        "dinámico",
        "lib/format-report-sections.ts"
      ),
      entry(
        `report-section-dimension-${typeName}`,
        "Sección: Resumen de dimensión",
        "Plantilla system para el bloque macro de cada dimensión.",
        buildSectionFormatSystemPrompt(dimensionSection, rubric),
        "dinámico",
        "lib/format-report-sections.ts"
      ),
      entry(
        `report-section-synthesis-${typeName}`,
        "Sección: Síntesis final",
        typeName === "IMET" ? "Versión para escala de niveles (IMET)." : "Versión para ponderaciones (IGIP).",
        typeName === "IMET"
          ? buildFinalSynthesisSystemPromptForLevels(synthesisSection, 2, "Nivel intermedio")
          : buildFinalSynthesisSystemPrompt(synthesisSection),
        "dinámico",
        "lib/format-report-sections.ts"
      ),
    ];

    categories.push({
      id: `report-${typeName.toLowerCase()}`,
      title: `Formato de informe (${typeName})`,
      description: `Plantillas system generadas según la rúbrica y el formato de informe ${typeName} (parametrizadas por sección y longitudes).`,
      prompts: reportPrompts,
    });
  }

  if (!igip && !imet) {
    categories.push({
      id: "types-missing",
      title: "Tipos de evaluación",
      description: "No se encontraron tipos IGIP/IMET en la base de datos.",
      prompts: [
        entry(
          "types-missing-note",
          "Sin tipos configurados",
          "Ejecute el backfill de tipos fijos o revise la base de datos.",
          "No hay datos de IGIP ni IMET para mostrar prompts por tipo.",
          "dinámico"
        ),
      ],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    categories,
  };
}
