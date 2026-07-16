"use client";

import type { ReactNode } from "react";
import type {
  RagConfig,
  ExtractConfig,
  ElementDefConfig,
} from "@/lib/evaluation-type-settings";
import { ExtractAdvancedConfigFields } from "@/components/config/ExtractAdvancedConfigFields";
import { fixedKeyFor } from "@/lib/eval-types/constants";
import type { ContextMode } from "@/lib/rag-limits";

/** Modos de chat; los límites de evaluación viven en §5 (evaluation_config.ragEvaluate). */
type ChatContextMode = Exclude<ContextMode, "evaluate">;

const CHAT_CONTEXT_MODES: ChatContextMode[] = [
  "chat-knowledge",
  "chat-project",
  "chat-chapter",
  "chat-config",
];

const inputClass =
  "w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const textareaClass = `${inputClass} min-h-[72px] resize-y font-mono`;
const fieldHintClass = "mb-1 text-[10px] leading-snug text-gray-500 dark:text-gray-400";

const CHAT_MODE_DESCRIPTIONS: Record<ChatContextMode, string> = {
  "chat-knowledge":
    "Chat centrado en los documentos de referencia (Knowledge): recupera fragmentos del índice RAG de manuales y guías.",
  "chat-project":
    "Chat sobre el proyecto cargado: prioriza fragmentos del índice del proyecto (Excel/PDF subido).",
  "chat-chapter":
    "Chat sobre un capítulo concreto del manual: usa el texto del capítulo seleccionado como contexto principal.",
  "chat-config":
    "Chat sobre la configuración del tipo de evaluación (rúbrica, elementos, etc.) sin consultar Knowledge.",
};

const RAG_LIMIT_HINTS = {
  topK: "Cantidad máxima de fragmentos que se recuperan del índice en cada búsqueda.",
  maxRetrievedChars: "Tope total de caracteres sumando todos los fragmentos recuperados.",
  maxSystemChars: "Tamaño máximo del mensaje system enviado al LLM (contexto + instrucciones).",
} as const;

const EXTRACT_FIELD_HINTS = {
  elementTimeoutMs:
    "Tiempo máximo (en milisegundos) que espera la extracción de cada elemento antes de marcar timeout o pasar al siguiente método.",
  systemPrompt:
    "Rol y reglas del agente LLM al extraer cada elemento (búsqueda en Excel/PDF, formato JSON). Si lo dejas vacío y guardas, se usa el prompt por defecto de IGIP o IMET definido en código.",
  sheetPatternGantt:
    "Expresión regular para detectar la hoja de carta Gantt o cronograma en el Excel del proyecto.",
  sheetPatternIndicators:
    "Expresión regular para localizar la hoja de indicadores de gestión.",
  sheetPatternResumen:
    "Expresión regular para la hoja resumen o ficha del proyecto (IGIP: Resumen Proyecto; IMET: ficha/formulario).",
  structurePromptGantt:
    "Instrucciones al LLM para convertir los datos crudos de la hoja Gantt en una lista numerada legible.",
  structurePromptIndicators:
    "Instrucciones al LLM para estructurar cada fila de la tabla de indicadores en bloques claros.",
} as const;

const ELEMENT_STRATEGY_HINTS = {
  skipDeterministic:
    "Si está activo, se omiten heurísticas y form_row; el elemento se resuelve solo con métodos LLM (rag_llm, gantt, indicators, etc.).",
  llmHints:
    "Pistas solo para este elemento: sinónimos de la etiqueta en el Excel, hoja donde suele aparecer, formato del valor, etc.",
  preferredMethods:
    "Orden de métodos a probar (heuristic, form_row, gantt, indicators, rag_llm, vision). Vacío = orden por defecto del sistema.",
  sheetPriority:
    "Nombres de hojas Excel (en orden) donde buscar primero este elemento antes que el resto del libro.",
} as const;

function ConfigFieldLabel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-0.5 block font-medium text-gray-700 dark:text-gray-200">{title}</span>
      <p className={fieldHintClass}>{hint}</p>
      {children}
    </label>
  );
}

export function RagConfigFields({
  rag,
  onChange,
}: {
  rag: RagConfig;
  onChange: (r: RagConfig) => void;
}) {
  const setMode = (mode: ChatContextMode, field: "topK" | "maxRetrievedChars" | "maxSystemChars", val: number) => {
    onChange({
      ...rag,
      modes: {
        ...rag.modes,
        [mode]: { ...rag.modes[mode], [field]: val },
      },
    });
  };

  return (
    <details className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-900/40">
      <summary className="cursor-pointer text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
        Parámetros RAG
      </summary>
      <p className={`mt-2 ${fieldHintClass}`}>
        Ajustan cómo se fragmentan los documentos de Knowledge al indexar y cuánto contexto
        recupera el chat al buscar en ese índice. La evaluación técnica usa parámetros propios en
        el submenú «Evaluación».
      </p>
      <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <ConfigFieldLabel
          title="Chunk (caracteres)"
          hint="Tamaño de cada fragmento al dividir los PDF/Word al reindexar. Fragmentos más grandes conservan más contexto por trozo; más pequeños mejoran la precisión de la búsqueda."
        >
          <input
            type="number"
            className={inputClass}
            value={rag.chunkSizeChars}
            onChange={(e) => onChange({ ...rag, chunkSizeChars: Number(e.target.value) })}
          />
        </ConfigFieldLabel>
        <ConfigFieldLabel
          title="Solapamiento"
          hint="Caracteres que se repiten entre fragmentos consecutivos para no cortar frases o tablas a la mitad en el límite del chunk."
        >
          <input
            type="number"
            className={inputClass}
            value={rag.overlapChars}
            onChange={(e) => onChange({ ...rag, overlapChars: Number(e.target.value) })}
          />
        </ConfigFieldLabel>
        <ConfigFieldLabel
          title="Query prompt (chars)"
          hint="Máximo de caracteres del mensaje del usuario que se usan para formular la consulta de búsqueda semántica en el índice."
        >
          <input
            type="number"
            className={inputClass}
            value={rag.queryLimits.ragQueryPromptChars}
            onChange={(e) =>
              onChange({
                ...rag,
                queryLimits: {
                  ...rag.queryLimits,
                  ragQueryPromptChars: Number(e.target.value),
                },
              })
            }
          />
        </ConfigFieldLabel>
        <ConfigFieldLabel
          title="Query rúbrica (chars)"
          hint="Máximo de caracteres de la rúbrica o criterio que se añaden a la consulta RAG cuando el contexto incluye criterios de evaluación."
        >
          <input
            type="number"
            className={inputClass}
            value={rag.queryLimits.ragQueryRubricChars}
            onChange={(e) =>
              onChange({
                ...rag,
                queryLimits: {
                  ...rag.queryLimits,
                  ragQueryRubricChars: Number(e.target.value),
                },
              })
            }
          />
        </ConfigFieldLabel>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Límites por modo de contexto (chat)</summary>
        <p className={`mt-1.5 ${fieldHintClass}`}>
          Cada modo corresponde a un tipo de conversación del agente de chat. Aquí se limita cuánto
          texto recuperado entra al prompt del LLM en cada caso.
        </p>
        <div className="mt-2 space-y-2">
          {CHAT_CONTEXT_MODES.map((mode) => (
            <div key={mode} className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">{mode}</div>
              <p className={fieldHintClass}>{CHAT_MODE_DESCRIPTIONS[mode]}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <ConfigFieldLabel title="topK" hint={RAG_LIMIT_HINTS.topK}>
                  <input
                    type="number"
                    className={inputClass}
                    value={rag.modes[mode]?.topK ?? 0}
                    onChange={(e) => setMode(mode, "topK", Number(e.target.value))}
                  />
                </ConfigFieldLabel>
                <ConfigFieldLabel title="maxRetrieved" hint={RAG_LIMIT_HINTS.maxRetrievedChars}>
                  <input
                    type="number"
                    className={inputClass}
                    value={rag.modes[mode]?.maxRetrievedChars ?? 0}
                    onChange={(e) => setMode(mode, "maxRetrievedChars", Number(e.target.value))}
                  />
                </ConfigFieldLabel>
                <ConfigFieldLabel title="maxSystem" hint={RAG_LIMIT_HINTS.maxSystemChars}>
                  <input
                    type="number"
                    className={inputClass}
                    value={rag.modes[mode]?.maxSystemChars ?? 0}
                    onChange={(e) => setMode(mode, "maxSystemChars", Number(e.target.value))}
                  />
                </ConfigFieldLabel>
              </div>
            </div>
          ))}
        </div>
      </details>
      </div>
    </details>
  );
}

const EXTRACT_METHOD_REFERENCE: {
  id: string;
  label: string;
  codes: string;
  description: string;
}[] = [
  {
    id: "heuristic",
    label: "heuristic",
    codes: "excel:label_value_row, excel:merge_block, excel:project_title_cell…",
    description:
      "Extracción determinista del Excel: busca etiquetas similares al título o descripción del elemento y lee el valor en la celda adyacente o bloque fusionado. Rápida y sin costo LLM; se usa cuando la confianza interna es alta (≥ 72 %).",
  },
  {
    id: "form_row",
    label: "form_row",
    codes: "form_row:…",
    description:
      "Atajo para filas de formulario en hojas tipo «Resumen Proyecto»: la pregunta o etiqueta está en una columna y la respuesta en la siguiente (a veces celdas fusionadas). Ideal para campos narrativos largos del formulario IGIP.",
  },
  {
    id: "gantt",
    label: "gantt",
    codes: "llm_gantt:high | medium | low",
    description:
      "Para elementos de actividades o cronograma: localiza la hoja Gantt (según el patrón regex configurado), extrae los datos crudos y el LLM los estructura en lista numerada usando el prompt de Gantt.",
  },
  {
    id: "indicators",
    label: "indicators",
    codes: "llm_indicators:high | medium | low",
    description:
      "Para tablas de indicadores: lee la hoja «Indicadores» y el LLM reorganiza cada indicador en bloques legibles usando el prompt de Indicadores.",
  },
  {
    id: "rag_llm",
    label: "rag_llm",
    codes: "llm_first:high | medium | low | empty | timeout",
    description:
      "Agente LLM con herramientas de búsqueda en todo el proyecto indexado (fragmentos RAG + Excel estructurado). Se usa cuando las heurísticas no bastan o el elemento requiere búsqueda semántica en varias hojas o PDFs.",
  },
  {
    id: "vision",
    label: "vision",
    codes: "(indexación)",
    description:
      "Extracción por visión al indexar PDFs e imágenes (modelo «vision» en Configurar LLM). Convierte páginas a texto antes del RAG; no es el método habitual por elemento, pero habilita proyectos solo en PDF.",
  },
];

const EXTRACT_DIAGNOSTIC_REFERENCE: { codes: string; description: string }[] = [
  {
    codes: ":high / :medium / :low",
    description:
      "Confianza declarada por el LLM en su respuesta JSON. No es un ajuste de configuración; aparece en el registro de extracción como diagnóstico.",
  },
  {
    codes: ":empty_retry",
    description: "El elemento quedó vacío y se reintentó con instrucciones más estrictas (definidas en código según IGIP/IMET).",
  },
  {
    codes: ":dup_retry",
    description: "Dos o más elementos devolvieron el mismo texto; se re-extrajo con pistas para diferenciarlos.",
  },
  {
    codes: ":continuity_fix",
    description: "Corrección automática cuando «Factor innovador» copiaba el texto de «Continuidad de fases anteriores».",
  },
];

function ExtractMethodsReference() {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-400">
        Métodos de extracción (referencia)
      </summary>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        Por cada elemento el sistema prueba métodos en orden (determinista → especializado → LLM).
        El código aparece en el chat durante la extracción como «Método: …». Por defecto se permiten
        todos; se pueden restringir por elemento al editarlo (campo avanzado).
      </p>
      <ol className="mt-2 space-y-2">
        {EXTRACT_METHOD_REFERENCE.map((m) => (
          <li
            key={m.id}
            className="rounded border border-gray-200 bg-white/60 p-2 dark:border-gray-700 dark:bg-gray-900/50"
          >
            <div className="font-mono text-[11px] font-semibold text-gray-800 dark:text-gray-100">
              {m.label}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-gray-500 dark:text-gray-400">{m.codes}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">
              {m.description}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Sufijos de diagnóstico
        </div>
        <ul className="mt-1.5 space-y-1.5">
          {EXTRACT_DIAGNOSTIC_REFERENCE.map((d) => (
            <li key={d.codes} className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">
              <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{d.codes}</span>
              {" — "}
              {d.description}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function ExtractConfigFieldsContent({
  extract,
  onChange,
  evaluationTypeName,
}: {
  extract: ExtractConfig;
  onChange: (e: ExtractConfig) => void;
  evaluationTypeName?: string | null;
}) {
  return (
    <div className="space-y-2">
      <ConfigFieldLabel title="Timeout por elemento (ms)" hint={EXTRACT_FIELD_HINTS.elementTimeoutMs}>
        <input
          type="number"
          className={inputClass}
          value={extract.elementTimeoutMs}
          onChange={(e) => onChange({ ...extract, elementTimeoutMs: Number(e.target.value) })}
        />
      </ConfigFieldLabel>
      <ConfigFieldLabel title="System prompt extracción (LLM + tools)" hint={EXTRACT_FIELD_HINTS.systemPrompt}>
        <textarea
          className={`${textareaClass} min-h-[120px]`}
          value={extract.prompts?.system ?? ""}
          onChange={(e) =>
            onChange({
              ...extract,
              prompts: { ...extract.prompts, system: e.target.value },
            })
          }
        />
      </ConfigFieldLabel>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Patrones de hojas y prompts de estructura</summary>
        <p className={`mt-1.5 ${fieldHintClass}`}>
          Regex y prompts que guían la detección de hojas especiales (Gantt, indicadores, resumen) y cómo el LLM
          formatea su contenido al extraer elementos concretos.
        </p>
        <div className="mt-2 space-y-2">
          <ConfigFieldLabel title="Patrón Gantt (regex)" hint={EXTRACT_FIELD_HINTS.sheetPatternGantt}>
            <input
              className={inputClass}
              value={extract.sheetPatterns.gantt}
              onChange={(e) =>
                onChange({
                  ...extract,
                  sheetPatterns: { ...extract.sheetPatterns, gantt: e.target.value },
                })
              }
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Patrón Indicadores (regex)" hint={EXTRACT_FIELD_HINTS.sheetPatternIndicators}>
            <input
              className={inputClass}
              value={extract.sheetPatterns.indicators}
              onChange={(e) =>
                onChange({
                  ...extract,
                  sheetPatterns: { ...extract.sheetPatterns, indicators: e.target.value },
                })
              }
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Patrón Resumen / ficha (regex)" hint={EXTRACT_FIELD_HINTS.sheetPatternResumen}>
            <input
              className={inputClass}
              value={extract.sheetPatterns.resumen}
              onChange={(e) =>
                onChange({
                  ...extract,
                  sheetPatterns: { ...extract.sheetPatterns, resumen: e.target.value },
                })
              }
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Prompt estructura Gantt" hint={EXTRACT_FIELD_HINTS.structurePromptGantt}>
            <textarea
              className={textareaClass}
              value={extract.structurePrompts.gantt}
              onChange={(e) =>
                onChange({
                  ...extract,
                  structurePrompts: { ...extract.structurePrompts, gantt: e.target.value },
                })
              }
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Prompt estructura Indicadores" hint={EXTRACT_FIELD_HINTS.structurePromptIndicators}>
            <textarea
              className={textareaClass}
              value={extract.structurePrompts.indicators}
              onChange={(e) =>
                onChange({
                  ...extract,
                  structurePrompts: {
                    ...extract.structurePrompts,
                    indicators: e.target.value,
                  },
                })
              }
            />
          </ConfigFieldLabel>
        </div>
      </details>
      <ExtractAdvancedConfigFields
        extract={extract}
        onChange={onChange}
        evaluationTypeName={evaluationTypeName}
      />
      <ExtractMethodsReference />
    </div>
  );
}

export function ExtractConfigFields({
  extract,
  onChange,
  embedded = false,
  evaluationTypeName,
}: {
  extract: ExtractConfig;
  onChange: (e: ExtractConfig) => void;
  /** Panel fijo para columna lateral (sin acordeón exterior). */
  embedded?: boolean;
  evaluationTypeName?: string | null;
}) {
  const typeKey = fixedKeyFor(evaluationTypeName);
  const typeIntro = `Parámetros del proceso híbrido (heurísticas + LLM). Los valores por defecto de prompts y pistas están definidos en código para ${typeKey}; los campos editables aquí son overrides de ese tipo.`;

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-col">
        <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
          Estrategia de extracción
        </h4>
        <p className={`mb-2 ${fieldHintClass}`}>{typeIntro}</p>
        <ExtractConfigFieldsContent
          extract={extract}
          onChange={onChange}
          evaluationTypeName={evaluationTypeName}
        />
      </div>
    );
  }

  return (
    <details className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-900/40" open>
      <summary className="cursor-pointer text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
        Estrategia de extracción (global)
      </summary>
      <p className={`mt-2 ${fieldHintClass}`}>{typeIntro}</p>
      <div className="mt-2">
        <ExtractConfigFieldsContent
          extract={extract}
          onChange={onChange}
          evaluationTypeName={evaluationTypeName}
        />
      </div>
    </details>
  );
}

export function ElementStrategyFields({
  strategy,
  onChange,
}: {
  strategy: ElementDefConfig["extractStrategy"];
  onChange: (s: ElementDefConfig["extractStrategy"]) => void;
}) {
  const s = strategy ?? {};
  return (
    <div className="mt-3 space-y-2 rounded border border-dashed border-gray-300 p-2 dark:border-gray-600">
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
        Estrategia de este elemento
      </div>
      <p className={fieldHintClass}>
        Ajustes opcionales que sobrescriben o refinan la estrategia global solo para este elemento al extraer el
        proyecto.
      </p>
      <div className="text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!s.skipDeterministic}
            onChange={(e) => onChange({ ...s, skipDeterministic: e.target.checked })}
          />
          <span className="font-medium text-gray-700 dark:text-gray-200">Omitir extracción determinista (solo LLM)</span>
        </label>
        <p className={fieldHintClass}>{ELEMENT_STRATEGY_HINTS.skipDeterministic}</p>
      </div>
      <ConfigFieldLabel title="Hints LLM adicionales" hint={ELEMENT_STRATEGY_HINTS.llmHints}>
        <textarea
          className={textareaClass}
          rows={3}
          value={s.llmHints ?? ""}
          onChange={(e) => onChange({ ...s, llmHints: e.target.value })}
        />
      </ConfigFieldLabel>
      <ConfigFieldLabel
        title="Métodos preferidos (heuristic, form_row, gantt, indicators, rag_llm, vision)"
        hint={ELEMENT_STRATEGY_HINTS.preferredMethods}
      >
        <input
          className={inputClass}
          placeholder="heuristic, rag_llm"
          value={(s.preferredMethods ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...s,
              preferredMethods: e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean) as ElementDefConfig["extractStrategy"] extends {
                preferredMethods?: infer M;
              }
                ? M
                : never,
            })
          }
        />
      </ConfigFieldLabel>
      <ConfigFieldLabel
        title="Prioridad de hojas (nombres separados por coma)"
        hint={ELEMENT_STRATEGY_HINTS.sheetPriority}
      >
        <input
          className={inputClass}
          placeholder="Resumen Proyecto, Indicadores"
          value={(s.sheetPriority ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...s,
              sheetPriority: e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </ConfigFieldLabel>
    </div>
  );
}
