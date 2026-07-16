"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import { inputClass, useEvaluationConfigHelpers } from "./evaluation-config-shared";

export function EvaluationLimitsFields({
  evaluation,
  rubric,
  reportFormat,
  onChange,
  tokenKeys,
}: {
  evaluation: EvaluationConfig;
  rubric: RubricConfig;
  reportFormat: ReportFormatConfig;
  onChange: (e: EvaluationConfig) => void;
  tokenKeys?: Array<keyof EvaluationConfig["maxTokens"]>;
}) {
  const { tokenLabels, maxTokenKeys, set, setOutput } = useEvaluationConfigHelpers({
    evaluation,
    rubric,
    reportFormat,
    onChange,
  });
  const keys = tokenKeys ?? maxTokenKeys;
  const outputLimitFields: Array<{
    key: keyof EvaluationConfig["outputLimits"];
    label: string;
  }> = [
    {
      key: "subdimensionEval",
      label: rubric.type === "ponderaciones" ? "Límites subdimensión" : "Límites variable",
    },
    ...(rubric.type !== "ponderaciones"
      ? [{ key: "assignedLevel" as const, label: "Límites nivel asignado" }]
      : []),
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        {keys.map((k) => (
          <label key={k}>
            {tokenLabels[k] ?? k}
            <input
              type="number"
              className={inputClass}
              value={evaluation.maxTokens[k]}
              onChange={(e) =>
                set("maxTokens", { ...evaluation.maxTokens, [k]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {outputLimitFields.map(({ key, label }) => (
          <div key={String(key)} className="rounded border border-gray-200 p-1.5 dark:border-gray-700">
            <div className="mb-1 text-[10px] font-medium uppercase text-gray-500">{label}</div>
            <div className="grid grid-cols-2 gap-1">
              <label>
                min
                <input
                  type="number"
                  className={inputClass}
                  value={evaluation.outputLimits[key].minChars}
                  onChange={(e) => setOutput(key, "minChars", Number(e.target.value))}
                />
              </label>
              <label>
                max
                <input
                  type="number"
                  className={inputClass}
                  value={evaluation.outputLimits[key].maxChars}
                  onChange={(e) => setOutput(key, "maxChars", Number(e.target.value))}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
