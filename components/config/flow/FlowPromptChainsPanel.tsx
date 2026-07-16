"use client";

import { useState } from "react";
import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";
import type {
  IgipPromptChain,
  IgipPromptChainNode,
  IgipPromptChainPart,
  PromptChainNodeType,
  ReportAssemblySequenceStep,
} from "@/lib/eval-flow/igip-prompt-chains-types";
import { FlowPromptDetailModal } from "./FlowPromptDetailModal";

const METHOD_BADGE: Record<ReportAssemblySequenceStep["method"], string> = {
  llm_section_format:
    "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  verbatim_subdimension:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  verbatim_variable:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  verbatim_assigned_level:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  llm_synthesis: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
};

function ReportAssemblySequenceView({
  steps,
  chainTitles,
}: {
  steps: ReportAssemblySequenceStep[];
  chainTitles: Map<string, string>;
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-2.5 dark:border-sky-900/50 dark:bg-sky-950/20">
      <p className="text-[10px] font-semibold text-sky-900 dark:text-sky-200">
        Orden de ensamblado (sección a sección)
      </p>
      <p className="mt-0.5 text-[9px] leading-relaxed text-sky-800/90 dark:text-sky-300/90">
        El informe no se genera en tres bloques separados: las cadenas de abajo son plantillas que
        se aplican intercaladas según esta secuencia. La síntesis final usa un prompt distinto al
        formateo por sección.
      </p>
      <ol className="mt-2 list-none space-y-1" aria-label="Orden de ensamblado del informe">
        {steps.map((step, idx) => (
          <li key={`${step.order}-${step.title}`} className="flex gap-2">
            <div className="flex w-4 shrink-0 flex-col items-center">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500"
                aria-hidden
              />
              {idx < steps.length - 1 && (
                <span className="mt-1 w-px flex-1 bg-sky-200 dark:bg-sky-800" aria-hidden />
              )}
            </div>
            <div className={`min-w-0 flex-1 ${idx < steps.length - 1 ? "pb-1" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium text-gray-800 dark:text-gray-100">
                  {step.order}. {step.title}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[8px] font-medium ${METHOD_BADGE[step.method]}`}
                >
                  {step.methodLabel}
                </span>
              </div>
              {chainTitles.has(step.chainId) && (
                <p className="text-[8px] text-gray-500 dark:text-gray-400">
                  Plantilla: {chainTitles.get(step.chainId)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[9px] text-sky-800/80 dark:text-sky-400">
        Después sigue el paso 6 (notas e índice / nivel asignado), sin LLM adicional.
      </p>
    </div>
  );
}

const NODE_TYPE_STYLES: Record<
  PromptChainNodeType,
  { label: string; badge: string; dot: string }
> = {
  system: {
    label: "SYSTEM",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
    dot: "bg-violet-500",
  },
  user: {
    label: "USER",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
    dot: "bg-sky-500",
  },
  tools: {
    label: "TOOLS",
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  context: {
    label: "CONTEXTO",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
  output: {
    label: "SALIDA",
    badge: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    dot: "bg-gray-400",
  },
};

const SOURCE_STYLES: Record<IgipPromptChainNode["source"], string> = {
  código: "text-slate-500 dark:text-slate-400",
  configuración: "text-emerald-600 dark:text-emerald-400",
  dinámico: "text-amber-600 dark:text-amber-400",
};

function PromptChainPartView({
  part,
  onOpenConfig,
}: {
  part: IgipPromptChainPart;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-md border border-gray-200/80 bg-white/70 px-2 py-1.5 dark:border-gray-600/80 dark:bg-gray-950/30">
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-medium text-gray-700 dark:text-gray-200">
              {part.title}
            </span>
            {part.source && (
              <span className={`text-[8px] uppercase ${SOURCE_STYLES[part.source]}`}>
                {part.source}
              </span>
            )}
          </div>
          {part.description && (
            <p className="mt-0.5 text-[9px] leading-snug text-gray-500 dark:text-gray-400">
              {part.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {part.configActionId && onOpenConfig && (
            <button
              type="button"
              onClick={() => onOpenConfig(part.configActionId!)}
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[9px] text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Configurar
            </button>
          )}
          {part.content && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded px-1.5 py-0.5 text-[9px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-expanded={expanded}
            >
              {expanded ? "Ocultar" : "Ver texto"}
            </button>
          )}
        </div>
      </div>
      {expanded && part.content && (
        <pre className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 p-1.5 font-mono text-[9px] leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
          {part.content}
        </pre>
      )}
    </li>
  );
}

function PromptChainNodeView({
  node,
  isLast,
  onOpenConfig,
  onOpenDetail,
}: {
  node: IgipPromptChainNode;
  isLast: boolean;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
  onOpenDetail?: (node: IgipPromptChainNode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = NODE_TYPE_STYLES[node.type];
  const displayText = node.fullContent ?? node.content;
  const isDynamic = node.source === "dinámico";
  const hasRelatedConfig = (node.relatedConfigActionIds?.length ?? 0) > 0;
  const showConfigButton = node.configActionId && onOpenConfig && !hasRelatedConfig;

  return (
    <li className="relative flex gap-2">
      <div className="flex w-4 shrink-0 flex-col items-center">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        {!isLast && <span className="mt-1 w-px flex-1 bg-gray-200 dark:bg-gray-600" aria-hidden />}
      </div>
      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-3"}`}>
        <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-600 dark:bg-gray-900/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${style.badge}`}
                >
                  {style.label}
                </span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{node.title}</span>
                <span className={`text-[9px] uppercase ${SOURCE_STYLES[node.source]}`}>{node.source}</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                {node.description}
              </p>
              {node.parts && node.parts.length > 0 && (
                <div className="mt-2 border-l-2 border-gray-200 pl-2 dark:border-gray-600">
                  <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    Partes del mensaje
                  </p>
                  <ul className="space-y-1">
                    {node.parts.map((part) => (
                      <PromptChainPartView
                        key={part.title}
                        part={part}
                        onOpenConfig={onOpenConfig}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {showConfigButton && (
                <button
                  type="button"
                  onClick={() => onOpenConfig(node.configActionId!)}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Configurar
                </button>
              )}
              {(isDynamic || node.truncated || node.assemblyFlow) && onOpenDetail && (
                <button
                  type="button"
                  onClick={() => onOpenDetail(node)}
                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
                >
                  {node.assemblyFlow ? "Mapa de ensamblado" : hasRelatedConfig ? "Estructura completa" : "Ver completo"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-expanded={expanded}
              >
                {expanded ? "Ocultar" : "Ver texto"}
              </button>
            </div>
          </div>
          {expanded && (
            <pre className="mt-2 max-h-[min(50vh,20rem)] overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-2 font-mono text-[10px] leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
              {displayText}
              {node.truncated && !node.fullContent && (
                <span className="mt-1 block text-[9px] text-gray-400">(vista previa truncada)</span>
              )}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

function PromptChainBlock({
  chain,
  onOpenConfig,
  onOpenDetail,
}: {
  chain: IgipPromptChain;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
  onOpenDetail?: (node: IgipPromptChainNode) => void;
}) {
  const nodeCountLabel =
    chain.nodes.length === 1 ? "1 nodo" : `${chain.nodes.length} nodos`;

  return (
    <details className="rounded-lg border border-dashed border-gray-300 bg-white/50 p-2.5 dark:border-gray-600 dark:bg-gray-900/20">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{chain.title}</span>
        {chain.repeatLabel && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
            {chain.repeatLabel}
          </span>
        )}
        <span className="text-[9px] text-gray-400 dark:text-gray-500">{nodeCountLabel}</span>
      </summary>
      {chain.hint && (
        <p className="mt-2 rounded-md border border-sky-200 bg-sky-50/80 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
          {chain.hint}
        </p>
      )}
      <ol className="mt-2 list-none" aria-label={chain.title}>
        {chain.nodes.map((node, idx) => (
          <PromptChainNodeView
            key={`${chain.id}-${node.order}`}
            node={node}
            isLast={idx === chain.nodes.length - 1}
            onOpenConfig={onOpenConfig}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </ol>
    </details>
  );
}

export function FlowPromptChainsPanel({
  chains,
  assemblySequence,
  loading,
  error,
  onOpenConfig,
}: {
  chains?: IgipPromptChain[];
  assemblySequence?: ReportAssemblySequenceStep[];
  loading?: boolean;
  error?: string | null;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
}) {
  const [detailNode, setDetailNode] = useState<IgipPromptChainNode | null>(null);

  if (loading) {
    return (
      <details className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 [&::-webkit-details-marker]:hidden">
          Encadenamiento LLM
        </summary>
        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">Cargando cadena de prompts…</p>
      </details>
    );
  }
  if (error) {
    return (
      <details className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 [&::-webkit-details-marker]:hidden">
          Encadenamiento LLM
        </summary>
        <p className="mt-2 text-[10px] text-red-600 dark:text-red-400">{error}</p>
      </details>
    );
  }
  if (!chains?.length) return null;

  const chainCountLabel =
    chains.length === 1 ? "1 cadena" : `${chains.length} cadenas`;

  const chainTitles = new Map(chains.map((c) => [c.id, c.title]));

  return (
    <>
      <details className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 [&::-webkit-details-marker]:hidden">
          <span>Encadenamiento LLM</span>
          <span className="font-normal normal-case text-gray-400 dark:text-gray-500">{chainCountLabel}</span>
        </summary>
        <div className="mt-2 space-y-2">
          {assemblySequence && assemblySequence.length > 0 && (
            <ReportAssemblySequenceView steps={assemblySequence} chainTitles={chainTitles} />
          )}
          <p className="text-[9px] leading-relaxed text-gray-500 dark:text-gray-400">
            Plantillas de mensajes (system → user). La repetición por sección sigue el orden de arriba.
          </p>
          {chains.map((chain) => (
            <PromptChainBlock
              key={chain.id}
              chain={chain}
              onOpenConfig={onOpenConfig}
              onOpenDetail={setDetailNode}
            />
          ))}
        </div>
      </details>

      <FlowPromptDetailModal
        node={detailNode}
        isOpen={detailNode != null}
        onClose={() => setDetailNode(null)}
        onOpenConfig={onOpenConfig}
      />
    </>
  );
}
