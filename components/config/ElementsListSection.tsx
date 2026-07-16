"use client";

import type { ElementDefConfig } from "@/lib/evaluation-type-settings";
import { getSectionColor } from "./config-panel-utils";

export function ElementsListSection({
  elements,
  onAddElement,
  onEditElement,
  onRemoveElement,
  onMoveElementUp,
  onMoveElementDown,
  onMoveSectionUp,
  onMoveSectionDown,
  onRemoveSection,
}: {
  elements: ElementDefConfig[];
  onAddElement: () => void;
  onEditElement: (index: number) => void;
  onRemoveElement: (index: number) => void;
  onMoveElementUp: (index: number) => void;
  onMoveElementDown: (index: number) => void;
  onMoveSectionUp: (sectionName: string) => void;
  onMoveSectionDown: (sectionName: string) => void;
  onRemoveSection: (sectionName: string) => void;
}) {
  const bySection = new Map<string, { element: ElementDefConfig; index: number }[]>();
  elements.forEach((el, i) => {
    const sec = (el.section ?? "General").trim() || "General";
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec)!.push({ element: el, index: i });
  });
  const sectionEntries = Array.from(bySection.entries());

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
        Lista de elementos
      </h4>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {sectionEntries.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No hay elementos definidos. Use «Añadir elemento» para crear el primero.
          </p>
        ) : (
          sectionEntries.map(([secName, items], sectionIndex) => {
            const colors = getSectionColor(elements, secName);
            const canSectionUp = sectionIndex > 0;
            const canSectionDown = sectionIndex < sectionEntries.length - 1;
            return (
              <div key={secName} className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-2.5`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                    {secName}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onMoveSectionUp(secName)}
                      disabled={!canSectionUp}
                      className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                      title="Subir sección"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveSectionDown(secName)}
                      disabled={!canSectionDown}
                      className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                      title="Bajar sección"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveSection(secName)}
                      className="rounded p-1 text-gray-500 hover:bg-red-200 hover:text-red-700 dark:hover:text-red-400"
                      title="Eliminar sección y todos sus elementos"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map(({ element: el, index }, itemIdx) => {
                    const positionInSection = itemIdx + 1;
                    const canElUp = itemIdx > 0;
                    const canElDown = itemIdx < items.length - 1;
                    return (
                      <div
                        key={index}
                        className={`flex items-center gap-0.5 rounded border ${colors.card} px-2 py-1 text-sm shadow-sm`}
                      >
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-300 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-200"
                          title={`Posición ${positionInSection} en la sección`}
                        >
                          {positionInSection}
                        </span>
                        <button
                          type="button"
                          onClick={() => onMoveElementUp(index)}
                          disabled={!canElUp}
                          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-300"
                          title="Subir dentro de la sección"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveElementDown(index)}
                          disabled={!canElDown}
                          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-300"
                          title="Bajar dentro de la sección"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100" title={el.title}>
                          {el.title || "(Sin título)"}
                        </span>
                        <button
                          type="button"
                          onClick={() => onEditElement(index)}
                          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-300"
                          title="Editar"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveElement(index)}
                          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-red-200 hover:text-red-700 dark:hover:text-red-400"
                          title="Quitar"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={onAddElement}
        className="mt-2 shrink-0 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Añadir elemento
      </button>
    </div>
  );
}
