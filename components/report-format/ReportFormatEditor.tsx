"use client";

import type { ReportCustomSection, ReportFormatConfig } from "@/lib/report-format-config";
import {
  DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS,
  DEFAULT_VARIABLE_EVAL_INSTRUCTIONS,
  listRubricFormatRows,
  newReportSectionId,
  syncReportFormatWithRubric,
} from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";

const inputClass =
  "w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const btnClass =
  "rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700";

function CharLimitsEditor({
  minChars,
  maxChars,
  onChange,
}: {
  minChars: number;
  maxChars: number;
  onChange: (min: number, max: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
      <label className="flex items-center gap-1">
        mín.
        <input
          type="number"
          className={`${inputClass} w-16`}
          value={minChars}
          onChange={(e) => onChange(Number(e.target.value), maxChars)}
        />
      </label>
      <label className="flex items-center gap-1">
        máx.
        <input
          type="number"
          className={`${inputClass} w-16`}
          value={maxChars}
          onChange={(e) => onChange(minChars, Number(e.target.value))}
        />
      </label>
    </div>
  );
}

function CustomSectionBlock({
  section,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  section: ReportCustomSection;
  onChange: (s: ReportCustomSection) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div className="rounded border border-dashed border-gray-300 p-2 dark:border-gray-600">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        {onMoveUp && (
          <button type="button" className={btnClass} onClick={onMoveUp} aria-label="Subir">
            ↑
          </button>
        )}
        {onMoveDown && (
          <button type="button" className={btnClass} onClick={onMoveDown} aria-label="Bajar">
            ↓
          </button>
        )}
        <input
          className={`${inputClass} min-w-[120px] flex-1 font-medium`}
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
          placeholder="Título de la sección"
        />
        <CharLimitsEditor
          minChars={section.minChars}
          maxChars={section.maxChars}
          onChange={(minChars, maxChars) => onChange({ ...section, minChars, maxChars })}
        />
        <button type="button" className={`${btnClass} text-red-600`} onClick={onRemove}>
          ×
        </button>
      </div>
      <textarea
        className={`${inputClass} min-h-[48px] resize-y`}
        value={section.description}
        onChange={(e) => onChange({ ...section, description: e.target.value })}
        placeholder="Qué debe incluir esta sección en el informe final"
      />
    </div>
  );
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function ReportFormatEditor({
  value,
  rubric,
  onChange,
}: {
  value: ReportFormatConfig;
  rubric: RubricConfig;
  onChange: (v: ReportFormatConfig) => void;
}) {
  const synced = syncReportFormatWithRubric(value, rubric);
  const rubricRows = listRubricFormatRows(rubric);
  const dimensionRows = rubricRows.filter((r) => r.kind === "dimension_overview");
  const subdimensionRows = rubricRows.filter((r) => r.kind === "subdimension_eval");
  const variableRows = rubricRows.filter((r) => r.kind === "variable_eval");

  const updatePreamble = (idx: number, sec: ReportCustomSection) => {
    const preamble = [...synced.preamble];
    preamble[idx] = sec;
    onChange({ ...synced, preamble });
  };

  const updateBeforeScores = (idx: number, sec: ReportCustomSection) => {
    const beforeScores = [...synced.beforeScores];
    beforeScores[idx] = sec;
    onChange({ ...synced, beforeScores });
  };

  const addCustom = (target: "preamble" | "beforeScores") => {
    const sec: ReportCustomSection = {
      id: newReportSectionId(),
      title: "",
      description: "",
      minChars: 200,
      maxChars: 500,
    };
    if (target === "preamble") {
      onChange({ ...synced, preamble: [...synced.preamble, sec] });
    } else {
      onChange({ ...synced, beforeScores: [...synced.beforeScores, sec] });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 text-xs">
      <p className="shrink-0 text-gray-500 dark:text-gray-400">
        Estructura y longitud del informe final. Los límites de caracteres se aplican en el paso de
        formateo (§6), no durante la evaluación técnica (§5).
      </p>

      <section className="min-h-0 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-gray-700 dark:text-gray-300">
            Secciones adicionales (inicio)
          </h4>
          <button type="button" className={btnClass} onClick={() => addCustom("preamble")}>
            + Añadir
          </button>
        </div>
        {synced.preamble.length === 0 ? (
          <p className="text-gray-400">Opcional — p. ej. resumen del proyecto.</p>
        ) : (
          synced.preamble.map((sec, i) => (
            <CustomSectionBlock
              key={sec.id}
              section={sec}
              onChange={(s) => updatePreamble(i, s)}
              onRemove={() =>
                onChange({ ...synced, preamble: synced.preamble.filter((_, j) => j !== i) })
              }
              onMoveUp={
                i > 0
                  ? () => onChange({ ...synced, preamble: moveItem(synced.preamble, i, i - 1) })
                  : undefined
              }
              onMoveDown={
                i < synced.preamble.length - 1
                  ? () => onChange({ ...synced, preamble: moveItem(synced.preamble, i, i + 1) })
                  : undefined
              }
            />
          ))
        )}
      </section>

      <section className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded border border-gray-200 bg-gray-50/50 p-2 dark:border-gray-700 dark:bg-gray-900/30">
        <h4 className="sticky top-0 z-10 bg-gray-50/95 py-1 font-medium text-gray-700 dark:bg-gray-900/95 dark:text-gray-300">
          Estructura obligatoria (de la rúbrica)
        </h4>

        {rubric.type === "ponderaciones" ? (
          <>
            <div className="rounded border border-gray-200 bg-white/60 p-2 dark:border-gray-600 dark:bg-gray-900/50">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  Resumen macro por dimensión ({dimensionRows.length})
                </span>
                <CharLimitsEditor
                  minChars={synced.dimensionOverviewLimits.minChars}
                  maxChars={synced.dimensionOverviewLimits.maxChars}
                  onChange={(minChars, maxChars) =>
                    onChange({ ...synced, dimensionOverviewLimits: { minChars, maxChars } })
                  }
                />
              </div>
              <p className="mb-1 text-[10px] text-gray-500">
                Se redacta en el paso de formateo, sintetizando las evaluaciones de subdimensiones
                del borrador (no es una evaluación aparte).
              </p>
              <label className="block">
                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
                  Contenido en el informe final
                </span>
                <textarea
                  className={`${inputClass} min-h-[56px] resize-y`}
                  value={synced.dimensionOverviewInstructions}
                  onChange={(e) =>
                    onChange({ ...synced, dimensionOverviewInstructions: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="rounded border border-gray-200 bg-white/60 p-2 dark:border-gray-600 dark:bg-gray-900/50">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  Evaluación por subdimensión ({subdimensionRows.length})
                </span>
                <CharLimitsEditor
                  minChars={synced.subdimensionEvalLimits.minChars}
                  maxChars={synced.subdimensionEvalLimits.maxChars}
                  onChange={(minChars, maxChars) =>
                    onChange({ ...synced, subdimensionEvalLimits: { minChars, maxChars } })
                  }
                />
              </div>
              <label className="block">
                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
                  Contenido en el informe final
                </span>
                <textarea
                  className={`${inputClass} min-h-[88px] resize-y`}
                  value={synced.subdimensionEvalInstructions}
                  onChange={(e) =>
                    onChange({ ...synced, subdimensionEvalInstructions: e.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className={`${btnClass} mt-1 text-gray-500`}
                onClick={() =>
                  onChange({
                    ...synced,
                    subdimensionEvalInstructions: DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS,
                  })
                }
              >
                Restaurar texto sugerido
              </button>
            </div>
          </>
        ) : rubric.type === "niveles" && variableRows.length > 0 ? (
          <>
            <div className="rounded border border-gray-200 bg-white/60 p-2 dark:border-gray-600 dark:bg-gray-900/50">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  Evaluación por variable ({variableRows.length})
                </span>
                <CharLimitsEditor
                  minChars={synced.subdimensionEvalLimits.minChars}
                  maxChars={synced.subdimensionEvalLimits.maxChars}
                  onChange={(minChars, maxChars) =>
                    onChange({ ...synced, subdimensionEvalLimits: { minChars, maxChars } })
                  }
                />
              </div>
              <textarea
                className={`${inputClass} min-h-[72px] resize-y`}
                value={synced.subdimensionEvalInstructions}
                onChange={(e) =>
                  onChange({ ...synced, subdimensionEvalInstructions: e.target.value })
                }
              />
              <button
                type="button"
                className={`${btnClass} mt-1 text-gray-500`}
                onClick={() =>
                  onChange({
                    ...synced,
                    subdimensionEvalInstructions: DEFAULT_VARIABLE_EVAL_INSTRUCTIONS,
                  })
                }
              >
                Restaurar texto sugerido
              </button>
              <ul className="mt-2 list-inside list-disc text-[10px] text-gray-500">
                {variableRows.map((r) => (
                  <li key={r.id}>{r.label}</li>
                ))}
              </ul>
            </div>
            <div className="rounded border border-gray-200 bg-white/60 p-2 dark:border-gray-600 dark:bg-gray-900/50">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Nivel asignado global</span>
                <CharLimitsEditor
                  minChars={synced.assignedLevelLimits?.minChars ?? 1500}
                  maxChars={synced.assignedLevelLimits?.maxChars ?? 2000}
                  onChange={(minChars, maxChars) =>
                    onChange({ ...synced, assignedLevelLimits: { minChars, maxChars } })
                  }
                />
              </div>
              <textarea
                className={`${inputClass} min-h-[72px] resize-y`}
                value={synced.assignedLevelInstructions ?? ""}
                onChange={(e) =>
                  onChange({ ...synced, assignedLevelInstructions: e.target.value })
                }
              />
            </div>
          </>
        ) : (
          <div className="rounded border border-gray-200 bg-white/60 p-2 dark:border-gray-600 dark:bg-gray-900/50">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Nivel asignado</span>
              <CharLimitsEditor
                minChars={synced.assignedLevelLimits?.minChars ?? 1500}
                maxChars={synced.assignedLevelLimits?.maxChars ?? 2000}
                onChange={(minChars, maxChars) =>
                  onChange({ ...synced, assignedLevelLimits: { minChars, maxChars } })
                }
              />
            </div>
            <textarea
              className={`${inputClass} min-h-[72px] resize-y`}
              value={synced.assignedLevelInstructions ?? ""}
              onChange={(e) =>
                onChange({ ...synced, assignedLevelInstructions: e.target.value })
              }
            />
          </div>
        )}
      </section>

      <section className="min-h-0 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-gray-700 dark:text-gray-300">
            Secciones adicionales (antes del cierre)
          </h4>
          <button type="button" className={btnClass} onClick={() => addCustom("beforeScores")}>
            + Añadir
          </button>
        </div>
        {synced.beforeScores.length === 0 ? (
          <p className="text-gray-400">Opcional — p. ej. síntesis final.</p>
        ) : (
          synced.beforeScores.map((sec, i) => (
            <CustomSectionBlock
              key={sec.id}
              section={sec}
              onChange={(s) => updateBeforeScores(i, s)}
              onRemove={() =>
                onChange({
                  ...synced,
                  beforeScores: synced.beforeScores.filter((_, j) => j !== i),
                })
              }
              onMoveUp={
                i > 0
                  ? () =>
                      onChange({
                        ...synced,
                        beforeScores: moveItem(synced.beforeScores, i, i - 1),
                      })
                  : undefined
              }
              onMoveDown={
                i < synced.beforeScores.length - 1
                  ? () =>
                      onChange({
                        ...synced,
                        beforeScores: moveItem(synced.beforeScores, i, i + 1),
                      })
                  : undefined
              }
            />
          ))
        )}
      </section>

      {rubric.type === "ponderaciones" && (
        <p className="shrink-0 rounded border border-dashed border-gray-300 bg-gray-50/60 p-2 text-gray-500 dark:border-gray-600 dark:bg-gray-900/30 dark:text-gray-400">
          Al finalizar la evaluación se añade automáticamente el bloque «Notas e índice»
          (ponderaciones de §4 e índice calculado). Alimenta el informe, PDF y tabla de
          resultados; no requiere configuración aquí.
        </p>
      )}
    </div>
  );
}
