"use client";

import type { ReactNode } from "react";
import type { ExtractConfig } from "@/lib/evaluation-type-settings";
import { EXTRACT_TYPE_HINTS_REFERENCE } from "@/lib/eval-types/extract-config-defaults";
import { fixedKeyFor } from "@/lib/eval-types/constants";

const inputClass =
  "w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const textareaClass = `${inputClass} min-h-[72px] resize-y font-mono`;
const fieldHintClass = "mb-1 text-[10px] leading-snug text-gray-500 dark:text-gray-400";

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

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-600 dark:bg-gray-900/30">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
        {title}
      </summary>
      {intro && <p className={`mt-2 ${fieldHintClass}`}>{intro}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

export function ExtractAdvancedConfigFields({
  extract,
  onChange,
  evaluationTypeName,
}: {
  extract: ExtractConfig;
  onChange: (e: ExtractConfig) => void;
  /** IGIP o IMET: filtra hints de reintento y referencia de pistas al tipo activo. */
  evaluationTypeName?: string | null;
}) {
  const typeKey = fixedKeyFor(evaluationTypeName);
  const setAgent = (patch: Partial<ExtractConfig["agent"]>) =>
    onChange({ ...extract, agent: { ...extract.agent, ...patch } });
  const setProjectIndex = (patch: Partial<ExtractConfig["projectIndex"]>) =>
    onChange({ ...extract, projectIndex: { ...extract.projectIndex, ...patch } });
  const setProjectRetrieve = (patch: Partial<ExtractConfig["projectRetrieve"]>) =>
    onChange({ ...extract, projectRetrieve: { ...extract.projectRetrieve, ...patch } });
  const setDuplicate = (patch: Partial<ExtractConfig["duplicateGuard"]>) =>
    onChange({ ...extract, duplicateGuard: { ...extract.duplicateGuard, ...patch } });
  const setRetry = (patch: Partial<ExtractConfig["retry"]>) =>
    onChange({ ...extract, retry: { ...extract.retry, ...patch } });
  const setHeuristics = (patch: Partial<ExtractConfig["heuristics"]>) =>
    onChange({ ...extract, heuristics: { ...extract.heuristics, ...patch } });
  const setVision = (patch: Partial<ExtractConfig["vision"]>) =>
    onChange({ ...extract, vision: { ...extract.vision, ...patch } });
  const setHints = (patch: Partial<ExtractConfig["hintOverrides"]>) =>
    onChange({ ...extract, hintOverrides: { ...extract.hintOverrides, ...patch } });

  return (
    <div className="space-y-2">
      <Section
        title="Agente LLM de extracción"
        intro="Parámetros del agente con herramientas (search_project, Excel estructurado, etc.)."
      >
        <div className="grid grid-cols-2 gap-2">
          <ConfigFieldLabel title="Iteraciones máx. herramientas" hint="Vueltas del bucle tool-calling antes de responder JSON.">
            <input
              type="number"
              className={inputClass}
              value={extract.agent.maxToolIterations}
              onChange={(e) => setAgent({ maxToolIterations: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Max tokens respuesta" hint="Tope de tokens por llamada al LLM de extracción.">
            <input
              type="number"
              className={inputClass}
              value={extract.agent.maxTokens}
              onChange={(e) => setAgent({ maxTokens: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Temperature" hint="Creatividad del modelo (0 = más determinista).">
            <input
              type="number"
              step="0.05"
              className={inputClass}
              value={extract.agent.temperature}
              onChange={(e) => setAgent({ temperature: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Timeout extra reintento vacío (ms)" hint="Tiempo adicional en el 2.º intento si el campo quedó vacío.">
            <input
              type="number"
              className={inputClass}
              value={extract.retry.emptyRetryExtraTimeoutMs}
              onChange={(e) => setRetry({ emptyRetryExtraTimeoutMs: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
        </div>
        <ConfigFieldLabel
          title="Plantilla user prompt del agente"
          hint="Placeholders: {{title}}, {{section}}, {{description}}, {{extraHints}}"
        >
          <textarea
            className={`${textareaClass} min-h-[100px]`}
            value={extract.agent.userPromptTemplate}
            onChange={(e) => setAgent({ userPromptTemplate: e.target.value })}
          />
        </ConfigFieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <ConfigFieldLabel title="Fallback topK (timeout)" hint="Fragmentos RAG si el agente hace timeout.">
            <input
              type="number"
              className={inputClass}
              value={extract.agent.fallbackTopK}
              onChange={(e) => setAgent({ fallbackTopK: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Fallback max chars (timeout)" hint="Caracteres máximos en el fallback RAG.">
            <input
              type="number"
              className={inputClass}
              value={extract.agent.fallbackMaxRetrievedChars}
              onChange={(e) => setAgent({ fallbackMaxRetrievedChars: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Tool search topK" hint="Fragmentos al usar la herramienta search_project.">
            <input
              type="number"
              className={inputClass}
              value={extract.agent.toolSearchTopK}
              onChange={(e) => setAgent({ toolSearchTopK: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Tool search max chars" hint="Caracteres máximos recuperados por search_project.">
            <input
              type="number"
              className={inputClass}
              value={extract.agent.toolSearchMaxRetrievedChars}
              onChange={(e) => setAgent({ toolSearchMaxRetrievedChars: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
        </div>
      </Section>

      <Section
        title="Índice RAG del proyecto"
        intro="Fragmentación del Excel/PDF subido al evaluar (índice de sesión, distinto del RAG de Documentos de referencia)."
      >
        <div className="grid grid-cols-2 gap-2">
          <ConfigFieldLabel title="Chunk (caracteres)" hint="Tamaño de cada fragmento al indexar el proyecto.">
            <input
              type="number"
              className={inputClass}
              value={extract.projectIndex.chunkSizeChars}
              onChange={(e) => setProjectIndex({ chunkSizeChars: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Solapamiento" hint="Caracteres repetidos entre fragmentos consecutivos.">
            <input
              type="number"
              className={inputClass}
              value={extract.projectIndex.overlapChars}
              onChange={(e) => setProjectIndex({ overlapChars: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Recuperación topK" hint="Fragmentos por consulta RAG del proyecto.">
            <input
              type="number"
              className={inputClass}
              value={extract.projectRetrieve.topK}
              onChange={(e) => setProjectRetrieve({ topK: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Recuperación max chars" hint="Tope total de caracteres recuperados.">
            <input
              type="number"
              className={inputClass}
              value={extract.projectRetrieve.maxRetrievedChars}
              onChange={(e) => setProjectRetrieve({ maxRetrievedChars: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Ventana vecinos" hint="Chunks adyacentes a incluir (0 = desactivado).">
            <input
              type="number"
              className={inputClass}
              value={extract.projectRetrieve.neighborWindow}
              onChange={(e) => setProjectRetrieve({ neighborWindow: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
        </div>
      </Section>

      <Section
        title="Detección de duplicados"
        intro="Tras extraer todos los elementos, reintenta si dos campos tienen el mismo texto."
      >
        <div className="grid grid-cols-2 gap-2">
          <ConfigFieldLabel title="Mín. caracteres para comparar" hint="Ignora textos más cortos al buscar duplicados.">
            <input
              type="number"
              className={inputClass}
              value={extract.duplicateGuard.minCompareChars}
              onChange={(e) => setDuplicate({ minCompareChars: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Umbral similitud (0–1)" hint="Por encima de este valor se considera duplicado.">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={extract.duplicateGuard.similarityThreshold}
              onChange={(e) => setDuplicate({ similarityThreshold: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
        </div>
        <ConfigFieldLabel
          title="Hint reintento por duplicado"
          hint="Placeholders: {{elementTitle}}, {{otherTitles}}, {{preview}}"
        >
          <textarea
            className={`${textareaClass} min-h-[120px]`}
            value={extract.duplicateGuard.retryHintBody}
            onChange={(e) => setDuplicate({ retryHintBody: e.target.value })}
          />
        </ConfigFieldLabel>
      </Section>

      <Section title="Heurísticas Excel" intro="Umbrales de confianza para aceptar extracción determinista sin LLM.">
        <div className="grid grid-cols-2 gap-2">
          <ConfigFieldLabel title="Confianza alta (mín.)" hint="Por encima: se acepta heurística sin LLM (p. ej. 0.72).">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={extract.heuristics.highConfidenceMin}
              onChange={(e) => setHeuristics({ highConfidenceMin: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
          <ConfigFieldLabel title="Confianza mínima usable" hint="Por debajo: se fuerza fallback LLM.">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={extract.heuristics.minUsableConfidence}
              onChange={(e) => setHeuristics({ minUsableConfidence: Number(e.target.value) })}
            />
          </ConfigFieldLabel>
        </div>
      </Section>

      <Section title="Visión (imágenes)" intro="Prompt al indexar JPG/PNG/WebP del proyecto con modelo visión.">
        <ConfigFieldLabel title="Prompt indexación visión" hint="Se envía al modelo visión al leer imágenes del proyecto.">
          <textarea
            className={`${textareaClass} min-h-[100px]`}
            value={extract.vision.indexPrompt}
            onChange={(e) => setVision({ indexPrompt: e.target.value })}
          />
        </ConfigFieldLabel>
      </Section>

      <Section
        title="Reintento campo vacío"
        intro={`Mensaje añadido al 2.º intento LLM cuando un elemento quedó sin contenido (solo ${typeKey}).`}
      >
        <ConfigFieldLabel
          title={`Hint reintento ${typeKey}`}
          hint={
            typeKey === "IMET"
              ? "Instrucciones para formularios pregunta/respuesta del IMET."
              : "Instrucciones para bitácoras IGIP (Resumen Proyecto, Gantt, Indicadores, PDF)."
          }
        >
          <textarea
            className={textareaClass}
            value={
              typeKey === "IMET"
                ? extract.hintOverrides.mandatoryRetryImet
                : extract.hintOverrides.mandatoryRetryIgip
            }
            onChange={(e) =>
              setHints(
                typeKey === "IMET"
                  ? { mandatoryRetryImet: e.target.value }
                  : { mandatoryRetryIgip: e.target.value }
              )
            }
          />
        </ConfigFieldLabel>
      </Section>

      <details className="rounded border border-gray-200 bg-gray-50/80 p-2 text-xs dark:border-gray-600 dark:bg-gray-900/30">
        <summary className="cursor-pointer font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
          Pistas automáticas por título — {typeKey} (solo lectura)
        </summary>
        <p className={`mt-2 ${fieldHintClass}`}>
          Reglas en código según el título del elemento. Solo se aplican las del tipo activo ({typeKey}).
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {EXTRACT_TYPE_HINTS_REFERENCE.filter((r) => r.type === typeKey).map((r) => (
            <li
              key={`${r.type}-${r.trigger}`}
              className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300"
            >
              <span className="font-medium">{r.trigger}</span>
              {" — "}
              {r.summary}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
