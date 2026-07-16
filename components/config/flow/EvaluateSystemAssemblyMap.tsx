"use client";

import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";
import type { EvaluateSystemAssemblyFlow } from "@/lib/eval-flow/evaluate-system-assembly-flow";
import { AssemblyStepCard } from "./AssemblyStepCard";
import { FlowConnector } from "./FlowConnector";

function needsContextSeparator(step: EvaluateSystemAssemblyFlow["steps"][number]): boolean {
  return (
    step.included &&
    step.stepKind === "text" &&
    step.assemblyPart != null &&
    step.assemblyPart >= 2 &&
    step.assemblyPart <= 5
  );
}

export function EvaluateSystemAssemblyMap({
  flow,
  onOpenConfig,
}: {
  flow: EvaluateSystemAssemblyFlow;
  onOpenConfig?: (actionId: FlowConfigActionId) => void;
}) {
  const textParts = flow.steps
    .filter((s) => s.included && s.stepKind === "text" && s.assemblyPart != null)
    .sort((a, b) => (a.assemblyPart ?? 0) - (b.assemblyPart ?? 0));

  const runtimeSteps = flow.steps
    .filter((s) => s.included && (s.stepKind === "process" || s.stepKind === "validation"))
    .sort((a, b) => a.order - b.order);

  const omittedSteps = flow.steps.filter((s) => !s.included);

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Ensamblado del mensaje <strong className="font-medium text-gray-700 dark:text-gray-200">SYSTEM</strong>{" "}
        para evaluación por {flow.focusLabel}: {textParts.length} bloques de texto en este orden exacto
        (partes P1–P{textParts.length}).
      </p>

      <ol className="mx-auto flex max-w-2xl list-none flex-col items-stretch gap-0">
        {textParts.map((step, idx) => (
          <li key={step.id} className="flex flex-col items-center">
            <AssemblyStepCard
              step={step}
              onOpenConfig={onOpenConfig}
              showSeparatorAfter={needsContextSeparator(step)}
            />
            {idx < textParts.length - 1 && <FlowConnector />}
          </li>
        ))}
      </ol>

      {runtimeSteps.length > 0 && (
        <details className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-950/20">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 [&::-webkit-details-marker]:hidden">
            Pasos de runtime (no añaden texto al mensaje)
          </summary>
          <ol className="mt-3 space-y-2">
            {runtimeSteps.map((step) => (
              <li key={step.id}>
                <AssemblyStepCard step={step} onOpenConfig={onOpenConfig} />
              </li>
            ))}
          </ol>
        </details>
      )}

      {omittedSteps.length > 0 && (
        <details className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-3 dark:border-gray-600 dark:bg-gray-900/30">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 [&::-webkit-details-marker]:hidden">
            Bloques no incluidos en evaluate ({omittedSteps.length})
          </summary>
          <ol className="mt-3 space-y-2">
            {omittedSteps.map((step) => (
              <li key={step.id}>
                <AssemblyStepCard step={step} onOpenConfig={onOpenConfig} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
