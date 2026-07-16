"use client";

import { useCallback, useEffect, useState } from "react";
import { IGIP_FLOW_STEPS, type FlowConfigActionId, type IgipFlowStep } from "@/lib/eval-flow/igip-flow-definition";
import { IMET_FLOW_STEPS } from "@/lib/eval-flow/imet-flow-definition";
import type { FixedEvalTypeKey } from "@/lib/eval-types/constants";
import type { IgipFlowPromptChainsResponse } from "@/lib/eval-flow/igip-prompt-chains-types";
import { FlowStepCard } from "./FlowStepCard";
import { FlowConnector } from "./FlowConnector";

export type FlowStepStatus = Partial<Record<string, string>>;

const FLOW_META: Record<
  FixedEvalTypeKey,
  { steps: IgipFlowStep[]; apiSegment: string; title: string; ariaLabel: string }
> = {
  IGIP: {
    steps: IGIP_FLOW_STEPS,
    apiSegment: "igip-flow-prompts",
    title: "Mapa del proceso IGIP",
    ariaLabel: "Pasos principales del proceso IGIP",
  },
  IMET: {
    steps: IMET_FLOW_STEPS,
    apiSegment: "imet-flow-prompts",
    title: "Mapa del proceso IMET",
    ariaLabel: "Pasos principales del proceso IMET",
  },
};

function stepStatusBadge(step: IgipFlowStep, statuses: FlowStepStatus): string | undefined {
  return statuses[step.id];
}

export function EvaluationFlowMap({
  evaluationTypeId,
  flowKind = "IGIP",
  steps,
  onOpenConfig,
  stepStatuses = {},
  refreshKey = 0,
}: {
  evaluationTypeId: number | null;
  flowKind?: FixedEvalTypeKey;
  steps?: IgipFlowStep[];
  onOpenConfig: (actionId: FlowConfigActionId) => void;
  stepStatuses?: FlowStepStatus;
  /** Incrementar tras guardar config para recargar vistas previas de prompts. */
  refreshKey?: number;
}) {
  const meta = FLOW_META[flowKind];
  const resolvedSteps = steps ?? meta.steps;

  const [promptData, setPromptData] = useState<IgipFlowPromptChainsResponse | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const loadPromptChains = useCallback(() => {
    if (!evaluationTypeId) {
      setPromptData(null);
      return;
    }
    setPromptLoading(true);
    setPromptError(null);
    fetch(`/api/config/${evaluationTypeId}/${meta.apiSegment}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Error al cargar prompts");
        return data as IgipFlowPromptChainsResponse;
      })
      .then(setPromptData)
      .catch((e) => {
        setPromptData(null);
        setPromptError(e instanceof Error ? e.message : "No se pudieron cargar los prompts");
      })
      .finally(() => setPromptLoading(false));
  }, [evaluationTypeId, meta.apiSegment]);

  useEffect(() => {
    loadPromptChains();
  }, [loadPromptChains, refreshKey]);

  const chainsForStep = (stepId: string) =>
    promptData?.steps.find((s) => s.stepId === stepId)?.chains;

  const assemblySequenceForStep = (stepId: string) =>
    promptData?.steps.find((s) => s.stepId === stepId)?.assemblySequence;

  const mainSteps = resolvedSteps.filter((s) => !s.branch);
  const branchSteps = resolvedSteps.filter((s) => s.branch);

  const renderStep = (step: IgipFlowStep, showConnectorAfter: boolean, connectorVariant: "main" | "branch" = "main") => (
    <li key={step.id} className="flex w-full flex-col items-center">
      <FlowStepCard
        step={step}
        statusBadge={stepStatusBadge(step, stepStatuses)}
        promptChains={chainsForStep(step.id)}
        assemblySequence={assemblySequenceForStep(step.id)}
        promptChainsLoading={promptLoading}
        promptChainsError={promptError}
        onActionClick={(id) => onOpenConfig(id as FlowConfigActionId)}
        onOpenConfig={onOpenConfig}
      />
      {showConnectorAfter && <FlowConnector variant={connectorVariant} />}
    </li>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-gray-200 pb-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{meta.title}</h3>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Flujo de evaluación de extremo a extremo. Cada paso muestra la cadena de mensajes (system → user → tools)
          en el orden en que se envían al LLM, junto con los botones de configuración.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4 pr-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-0 lg:flex-row lg:items-start lg:gap-6">
          <ol className="flex flex-1 flex-col items-center" aria-label={meta.ariaLabel}>
            {mainSteps.map((step, idx) => {
              const isLast = idx === mainSteps.length - 1;
              return renderStep(step, !isLast, "main");
            })}
          </ol>

          {branchSteps.length > 0 && (
            <aside
              className="mt-2 flex w-full shrink-0 flex-col items-center lg:mt-12 lg:w-72 lg:items-stretch"
              aria-label="Rama de base de conocimiento"
            >
              <p className="mb-2 hidden text-center text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 lg:block">
                Alimenta RAG en evaluación
              </p>
              <ol className="flex w-full flex-col items-center">
                {branchSteps.map((step, idx) => {
                  const isLast = idx === branchSteps.length - 1;
                  return renderStep(step, !isLast, "branch");
                })}
              </ol>
              <div className="mt-1 hidden items-center justify-center lg:flex" aria-hidden>
                <svg className="h-16 w-24 text-emerald-400 dark:text-emerald-600" viewBox="0 0 96 64" fill="none">
                  <path
                    d="M4 32 H40 Q56 32 56 48 V60"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                  <path d="M52 56 L60 60 L52 64" fill="currentColor" />
                </svg>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
