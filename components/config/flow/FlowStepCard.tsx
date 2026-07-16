"use client";

import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";
import type { IgipFlowStep } from "@/lib/eval-flow/igip-flow-definition";
import type { IgipPromptChain, ReportAssemblySequenceStep } from "@/lib/eval-flow/igip-prompt-chains-types";
import { FlowPromptChainsPanel } from "./FlowPromptChainsPanel";

export function FlowStepCard({
  step,
  statusBadge,
  promptChains,
  assemblySequence,
  promptChainsLoading,
  promptChainsError,
  onActionClick,
  onOpenConfig,
}: {
  step: IgipFlowStep;
  statusBadge?: string;
  promptChains?: IgipPromptChain[];
  assemblySequence?: ReportAssemblySequenceStep[];
  promptChainsLoading?: boolean;
  promptChainsError?: string | null;
  onActionClick: (actionId: string) => void;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
}) {
  return (
    <article
      className={`relative w-full max-w-2xl rounded-xl border-2 bg-white p-4 shadow-sm dark:bg-gray-900/60 ${
        step.branch
          ? "border-emerald-300 dark:border-emerald-700"
          : step.readOnly
            ? "border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-800/40"
            : "border-gray-200 dark:border-gray-600"
      }`}
      aria-labelledby={`flow-step-${step.id}-title`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            step.readOnly
              ? "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              : step.branch
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
                : "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200"
          }`}
        >
          {step.order}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`flow-step-${step.id}-title`}
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {step.title}
            </h3>
            {statusBadge && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {statusBadge}
              </span>
            )}
            {step.branch && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                Rama lateral → evaluación
              </span>
            )}
            {step.readOnly && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                Automático
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{step.description}</p>
          {step.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Configuración de ${step.title}`}>
              {step.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onActionClick(action.id)}
                  className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-sky-600 dark:hover:bg-sky-950/40 dark:hover:text-sky-100"
                  aria-label={`Configurar: ${action.label}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
          <FlowPromptChainsPanel
            chains={promptChains}
            assemblySequence={assemblySequence}
            loading={promptChainsLoading}
            error={promptChainsError}
            onOpenConfig={onOpenConfig}
          />
        </div>
      </div>
    </article>
  );
}
