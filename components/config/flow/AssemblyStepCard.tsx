"use client";

import { useState } from "react";
import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";
import { getFlowActionLabel } from "@/lib/eval-flow/igip-flow-definition";
import type { EvaluateSystemAssemblyStep } from "@/lib/eval-flow/evaluate-system-assembly-flow";
import type { SystemPromptSource } from "@/lib/system-prompts-catalog";

const SOURCE_STYLES: Record<SystemPromptSource, string> = {
  código: "text-slate-500 dark:text-slate-400",
  configuración: "text-emerald-600 dark:text-emerald-400",
  dinámico: "text-amber-600 dark:text-amber-400",
};

const KIND_STYLES: Record<
  EvaluateSystemAssemblyStep["stepKind"],
  { label: string; badge: string }
> = {
  text: {
    label: "Texto en el mensaje",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200",
  },
  process: {
    label: "Control de runtime",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  validation: {
    label: "Validación",
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200",
  },
};

export function AssemblyStepCard({
  step,
  onOpenConfig,
  showSeparatorAfter,
}: {
  step: EvaluateSystemAssemblyStep;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
  showSeparatorAfter?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const kindStyle = KIND_STYLES[step.stepKind];

  return (
    <article
      className={`relative w-full rounded-xl border-2 bg-white p-3 shadow-sm dark:bg-gray-900/60 ${
        !step.included
          ? "border-dashed border-gray-300 opacity-75 dark:border-gray-600"
          : step.stepKind === "text"
            ? "border-violet-200 dark:border-violet-800"
            : step.stepKind === "validation"
              ? "border-amber-300 dark:border-amber-700"
              : "border-slate-300 dark:border-slate-600"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-full text-[10px] font-bold leading-tight ${
            step.assemblyPart != null
              ? "bg-violet-600 text-white dark:bg-violet-500"
              : step.stepKind === "validation"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          {step.assemblyPart != null ? (
            <>
              <span className="text-[8px] font-normal opacity-80">P</span>
              {step.assemblyPart}
            </>
          ) : (
            "·"
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-100">{step.title}</h4>
            <span className={`rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase ${kindStyle.badge}`}>
              {kindStyle.label}
            </span>
            <span className={`text-[9px] uppercase ${SOURCE_STYLES[step.source]}`}>{step.source}</span>
            {!step.included && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                No incluido
              </span>
            )}
          </div>
          {step.heading && step.included && step.stepKind === "text" && (
            <p className="mt-1 font-mono text-[10px] text-violet-700 dark:text-violet-300">{step.heading}</p>
          )}
          <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
            {step.description}
          </p>
          {!step.included && step.omitReason && (
            <p className="mt-1 text-[10px] italic text-gray-400 dark:text-gray-500">{step.omitReason}</p>
          )}
          {step.codeReference && (
            <p className="mt-1 font-mono text-[9px] text-gray-400 dark:text-gray-500">{step.codeReference}</p>
          )}

          {step.configActionIds.length > 0 && onOpenConfig && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {step.configActionIds.map((actionId) => (
                <button
                  key={actionId}
                  type="button"
                  onClick={() => onOpenConfig(actionId)}
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[10px] font-medium text-gray-700 hover:border-sky-400 hover:bg-sky-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-sky-600 dark:hover:bg-sky-950/40"
                >
                  {getFlowActionLabel(actionId)}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-expanded={expanded}
          >
            {expanded ? "Ocultar contenido" : "Ver contenido"}
          </button>

          {expanded && (
            <pre className="mt-2 max-h-[min(40vh,16rem)] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-[10px] leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
              {step.fullContent}
            </pre>
          )}
        </div>
      </div>
      {showSeparatorAfter && (
        <p className="mt-2 text-center font-mono text-[9px] text-gray-400 dark:text-gray-500">
          --- separador ---
        </p>
      )}
    </article>
  );
}
