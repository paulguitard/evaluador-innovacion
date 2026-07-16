"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import { inputClass, useEvaluationConfigHelpers } from "./evaluation-config-shared";

export function EvaluationRagFields({
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
  const { set } = useEvaluationConfigHelpers({ evaluation, rubric, reportFormat, onChange });

  return (
    <div className="space-y-2">
      <label>
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
          Elementos proyecto en RAG
        </span>
        <input
          type="number"
          className={inputClass}
          min={1}
          max={50}
          value={evaluation.projectElementsInRagQuery}
          onChange={(e) => set("projectElementsInRagQuery", Number(e.target.value))}
        />
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        <label>
          <span className="mb-0.5 block text-[10px] text-gray-500">RAG topK</span>
          <span className="mb-0.5 block text-[9px] leading-snug text-gray-400">
            Máx. fragmentos recuperados del Knowledge
          </span>
          <input
            type="number"
            className={inputClass}
            value={evaluation.ragEvaluate.topK ?? ""}
            onChange={(e) =>
              set("ragEvaluate", {
                ...evaluation.ragEvaluate,
                topK: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] text-gray-500">RAG max chars</span>
          <span className="mb-0.5 block text-[9px] leading-snug text-gray-400">
            Tope de caracteres solo de los fragmentos RAG
          </span>
          <input
            type="number"
            className={inputClass}
            value={evaluation.ragEvaluate.maxRetrievedChars ?? ""}
            onChange={(e) =>
              set("ragEvaluate", {
                ...evaluation.ragEvaluate,
                maxRetrievedChars: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] text-gray-500">System max chars</span>
          <span className="mb-0.5 block text-[9px] leading-snug text-gray-400">
            Tope del system message ensamblado completo
          </span>
          <input
            type="number"
            className={inputClass}
            value={evaluation.ragEvaluate.maxSystemChars ?? ""}
            onChange={(e) =>
              set("ragEvaluate", {
                ...evaluation.ragEvaluate,
                maxSystemChars: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
      </div>
    </div>
  );
}
