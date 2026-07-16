"use client";

import { useMemo } from "react";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  enrichEvaluationPromptsForDisplay,
  buildEvaluationFormatPromptReference,
} from "@/lib/evaluation-prompt-resolver";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";

export const inputClass =
  "w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
export const textareaClass = `${inputClass} min-h-[72px] resize-y font-mono`;

export function evalTokenLabels(
  rubric: RubricConfig
): Partial<Record<keyof EvaluationConfig["maxTokens"], string>> {
  return {
    dimensionOverview: "Tokens nivel global",
    subdimension: rubric.type === "ponderaciones" ? "Subdimensión" : "Variable",
    formatReport: "Formateo informe",
    summary: "Síntesis final",
  };
}

export function visibleMaxTokenKeys(
  rubric: RubricConfig
): Array<keyof EvaluationConfig["maxTokens"]> {
  void rubric;
  return Object.keys(evalTokenLabels(rubric)) as Array<keyof EvaluationConfig["maxTokens"]>;
}

export function useEvaluationConfigHelpers({
  evaluation,
  rubric,
  reportFormat,
  onChange,
}: {
  evaluation: EvaluationConfig;
  rubric: RubricConfig;
  reportFormat: ReportFormatConfig;
  onChange: (e: EvaluationConfig) => void;
}) {
  const displayEvaluation = useMemo(
    () => enrichEvaluationPromptsForDisplay(evaluation, rubric),
    [evaluation, rubric]
  );
  const formatReference = useMemo(
    () => buildEvaluationFormatPromptReference(rubric, reportFormat),
    [rubric, reportFormat]
  );
  const tokenLabels = useMemo(() => evalTokenLabels(rubric), [rubric]);
  const maxTokenKeys = useMemo(() => visibleMaxTokenKeys(rubric), [rubric]);

  const set = <K extends keyof EvaluationConfig>(key: K, val: EvaluationConfig[K]) =>
    onChange({ ...evaluation, [key]: val });

  const setPhase = (key: keyof EvaluationConfig["phaseInstructions"], val: string) =>
    onChange({
      ...evaluation,
      phaseInstructions: { ...evaluation.phaseInstructions, [key]: val },
    });

  const setPrompt = (key: keyof EvaluationConfig["prompts"], val: string) =>
    onChange({ ...evaluation, prompts: { ...evaluation.prompts, [key]: val } });

  const setOutput = (
    key: keyof EvaluationConfig["outputLimits"],
    field: "minChars" | "maxChars",
    val: number
  ) =>
    onChange({
      ...evaluation,
      outputLimits: {
        ...evaluation.outputLimits,
        [key]: { ...evaluation.outputLimits[key], [field]: val },
      },
    });

  return {
    displayEvaluation,
    formatReference,
    tokenLabels,
    maxTokenKeys,
    set,
    setPhase,
    setPrompt,
    setOutput,
  };
}

export function PromptField({
  label,
  hint,
  value,
  onChange,
  onRestore,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onRestore: () => void;
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-600 dark:bg-gray-900/40">
      <span className="mb-1 block font-medium text-gray-800 dark:text-gray-200">{label}</span>
      {hint && <p className="mb-1 text-[10px] text-gray-500">{hint}</p>}
      <textarea className={`${textareaClass} min-h-[100px]`} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="mt-1 text-gray-500 hover:underline" onClick={onRestore}>
        Restaurar default
      </button>
    </div>
  );
}

export function ReadOnlyPromptField({
  label,
  hint,
  value,
}: {
  label: string;
  hint?: string;
  value: string;
}) {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-white/50 p-2 dark:border-gray-600 dark:bg-gray-900/20">
      <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {hint && <p className="mb-1 text-[10px] text-gray-500">{hint}</p>}
      <textarea
        className={`${textareaClass} min-h-[100px] cursor-default bg-gray-50 text-gray-700 dark:bg-gray-900/60 dark:text-gray-300`}
        value={value}
        readOnly
      />
    </div>
  );
}
