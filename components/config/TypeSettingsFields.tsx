"use client";

import type {
  PipelineConfig,
  RagConfig,
  ExtractConfig,
  ElementDefConfig,
} from "@/lib/evaluation-type-settings";
import type { ContextMode } from "@/lib/rag-limits";

/** Modos de chat; los límites de evaluación viven en §5 (evaluation_config.ragEvaluate). */
const CHAT_CONTEXT_MODES: ContextMode[] = [
  "chat-knowledge",
  "chat-project",
  "chat-chapter",
  "chat-config",
];

const inputClass =
  "w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const textareaClass = `${inputClass} min-h-[72px] resize-y font-mono`;

export function PipelineConfigFields({
  pipeline,
  onChange,
  compact = false,
}: {
  pipeline: PipelineConfig;
  onChange: (p: PipelineConfig) => void;
  /** Layout denso para la celda 1 del panel de configuración. */
  compact?: boolean;
}) {
  const set = <K extends keyof PipelineConfig>(key: K, val: PipelineConfig[K]) =>
    onChange({ ...pipeline, [key]: val });

  const coreFields = (
    <>
      <div className={compact ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-2 gap-2"}>
        <label className="text-xs">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Etiqueta índice
          </span>
          <input
            className={inputClass}
            value={pipeline.indicatorLabel}
            onChange={(e) => set("indicatorLabel", e.target.value)}
          />
        </label>
        <label
          className={`flex items-end gap-2 text-xs ${compact ? "" : "col-span-1"}`}
        >
          <input
            type="checkbox"
            checked={pipeline.parallelSubdimensions}
            onChange={(e) => set("parallelSubdimensions", e.target.checked)}
          />
          Subdimensiones en paralelo
        </label>
        <label
          className={`flex items-end gap-2 text-xs ${compact ? "" : "col-span-1"}`}
        >
          <input
            type="checkbox"
            checked={pipeline.parallelDimensions}
            onChange={(e) => set("parallelDimensions", e.target.checked)}
          />
          Dimensiones en paralelo
        </label>
      </div>
    </>
  );

  const advanced = (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-400">
        Tokens y prompts
      </summary>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {(Object.keys(pipeline.maxTokens) as Array<keyof PipelineConfig["maxTokens"]>).map(
          (k) => (
            <label key={k} className="text-xs">
              {k}
              <input
                type="number"
                className={inputClass}
                value={pipeline.maxTokens[k]}
                onChange={(e) =>
                  set("maxTokens", { ...pipeline.maxTokens, [k]: Number(e.target.value) })
                }
              />
            </label>
          )
        )}
      </div>
      <label className="mt-1.5 block">
        Prompt JSON notas
        <textarea
          className={textareaClass}
          value={pipeline.prompts.scoreJsonSystem ?? ""}
          onChange={(e) =>
            set("prompts", { ...pipeline.prompts, scoreJsonSystem: e.target.value })
          }
        />
      </label>
    </details>
  );

  if (compact) {
    return (
      <div className="space-y-1.5 rounded-md border border-gray-200/80 bg-gray-50/60 p-2 dark:border-gray-600/80 dark:bg-gray-900/30">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Pipeline
        </div>
        {coreFields}
        <div className="pt-0.5">{advanced}</div>
      </div>
    );
  }

  return (
    <details className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-900/40">
      <summary className="cursor-pointer text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
        Pipeline de evaluación
      </summary>
      <div className="mt-2 space-y-2">
        {coreFields}
        {advanced}
      </div>
    </details>
  );
}

export function RagConfigFields({
  rag,
  onChange,
}: {
  rag: RagConfig;
  onChange: (r: RagConfig) => void;
}) {
  const setMode = (mode: ContextMode, field: "topK" | "maxRetrievedChars" | "maxSystemChars", val: number) => {
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
      <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          Chunk (caracteres)
          <input
            type="number"
            className={inputClass}
            value={rag.chunkSizeChars}
            onChange={(e) => onChange({ ...rag, chunkSizeChars: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs">
          Solapamiento
          <input
            type="number"
            className={inputClass}
            value={rag.overlapChars}
            onChange={(e) => onChange({ ...rag, overlapChars: Number(e.target.value) })}
          />
        </label>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Límites por modo de contexto (chat)</summary>
        <div className="mt-2 space-y-2">
          {CHAT_CONTEXT_MODES.map((mode) => (
            <div key={mode} className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <div className="mb-1 font-medium">{mode}</div>
              <div className="grid grid-cols-3 gap-1">
                <label>
                  topK
                  <input
                    type="number"
                    className={inputClass}
                    value={rag.modes[mode]?.topK ?? 0}
                    onChange={(e) => setMode(mode, "topK", Number(e.target.value))}
                  />
                </label>
                <label>
                  maxRetrieved
                  <input
                    type="number"
                    className={inputClass}
                    value={rag.modes[mode]?.maxRetrievedChars ?? 0}
                    onChange={(e) => setMode(mode, "maxRetrievedChars", Number(e.target.value))}
                  />
                </label>
                <label>
                  maxSystem
                  <input
                    type="number"
                    className={inputClass}
                    value={rag.modes[mode]?.maxSystemChars ?? 0}
                    onChange={(e) => setMode(mode, "maxSystemChars", Number(e.target.value))}
                  />
                </label>
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
    description: "El elemento quedó vacío y se reintentó con instrucciones más estrictas (mandatoryLlmRetryHint).",
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

export function ExtractConfigFields({
  extract,
  onChange,
}: {
  extract: ExtractConfig;
  onChange: (e: ExtractConfig) => void;
}) {
  return (
    <details className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-900/40">
      <summary className="cursor-pointer text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
        Estrategia de extracción (global)
      </summary>
      <div className="mt-2 space-y-2">
      <label className="block text-xs">
        Timeout por elemento (ms)
        <input
          type="number"
          className={inputClass}
          value={extract.elementTimeoutMs}
          onChange={(e) => onChange({ ...extract, elementTimeoutMs: Number(e.target.value) })}
        />
      </label>
      <label className="block text-xs">
        Hints LLM globales
        <textarea
          className={textareaClass}
          value={extract.globalLlmHints}
          onChange={(e) => onChange({ ...extract, globalLlmHints: e.target.value })}
        />
      </label>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Patrones de hojas y prompts</summary>
        <div className="mt-2 space-y-2">
          <label className="block">
            Patrón Gantt (regex)
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
          </label>
          <label className="block">
            Prompt estructura Gantt
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
          </label>
          <label className="block">
            Prompt estructura Indicadores
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
          </label>
        </div>
      </details>
      <ExtractMethodsReference />
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
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={!!s.skipDeterministic}
          onChange={(e) => onChange({ ...s, skipDeterministic: e.target.checked })}
        />
        Omitir extracción determinista (solo LLM)
      </label>
      <label className="block text-xs">
        Hints LLM adicionales
        <textarea
          className={textareaClass}
          rows={3}
          value={s.llmHints ?? ""}
          onChange={(e) => onChange({ ...s, llmHints: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        Métodos preferidos (separados por coma: heuristic, form_row, gantt, indicators, rag_llm, vision)
        <input
          className={inputClass}
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
      </label>
    </div>
  );
}
