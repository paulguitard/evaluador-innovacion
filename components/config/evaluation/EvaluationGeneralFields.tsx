"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import { inputClass, useEvaluationConfigHelpers } from "./evaluation-config-shared";

export function EvaluationGeneralFields({
  evaluation,
  rubric,
  reportFormat,
  onChange,
  includeReportRatio = true,
}: {
  evaluation: EvaluationConfig;
  rubric: RubricConfig;
  reportFormat: import("@/lib/report-format-config").ReportFormatConfig;
  onChange: (e: EvaluationConfig) => void;
  includeReportRatio?: boolean;
}) {
  const { set } = useEvaluationConfigHelpers({ evaluation, rubric, reportFormat, onChange });

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2">
      <label>
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">Etiqueta índice</span>
        <input
          className={inputClass}
          value={evaluation.indicatorLabel}
          onChange={(e) => set("indicatorLabel", e.target.value)}
        />
      </label>
      <label>
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">Etiqueta knowledge</span>
        <input
          className={inputClass}
          value={evaluation.knowledgeReferenceLabel}
          onChange={(e) => set("knowledgeReferenceLabel", e.target.value)}
          placeholder="Manual de referencia"
        />
      </label>
      {includeReportRatio && (
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
            Ratio mín. caracteres (informe)
          </span>
          <input
            type="number"
            step={0.05}
            min={0.5}
            max={1}
            className={inputClass}
            value={evaluation.charRangeMinRatio}
            onChange={(e) => set("charRangeMinRatio", Number(e.target.value))}
          />
        </label>
      )}
      {rubric.type === "ponderaciones" ? (
        <>
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={evaluation.parallelSubdimensions}
              onChange={(e) => set("parallelSubdimensions", e.target.checked)}
            />
            Subdimensiones en paralelo
          </label>
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={evaluation.parallelDimensions}
              onChange={(e) => set("parallelDimensions", e.target.checked)}
            />
            Dimensiones en paralelo
          </label>
        </>
      ) : (
        <label className="col-span-2 flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={evaluation.parallelSubdimensions}
            onChange={(e) => set("parallelSubdimensions", e.target.checked)}
          />
          Variables en paralelo
        </label>
      )}
    </div>
  );
}
