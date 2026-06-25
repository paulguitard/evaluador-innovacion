"use client";

import { useCallback } from "react";
import { isIncompleteElement } from "@/lib/project-extract-validate";
import type { ElementDef } from "@/lib/excel-heuristics";

export type ProjectExtractedRow = {
  section: string;
  element: string;
  content: string;
  incomplete?: boolean;
};

type Props = {
  rows: ProjectExtractedRow[];
  elementsWithSection: { title: string; section: string }[];
  extractedProjectText: string;
};

function orderRows(
  rawRows: ProjectExtractedRow[],
  elementsWithSection: { title: string; section: string }[]
): ProjectExtractedRow[] {
  const sectionOrder: string[] = [];
  for (const e of elementsWithSection) {
    if (!sectionOrder.includes(e.section)) sectionOrder.push(e.section);
  }
  const titleOrder: string[] = [];
  for (const sec of sectionOrder) {
    for (const e of elementsWithSection) {
      if (e.section === sec) titleOrder.push(e.title);
    }
  }
  const rowsOrdered: ProjectExtractedRow[] = [];
  for (const title of titleOrder) {
    const row = rawRows.find((r) => r.element.trim() === title);
    if (row) rowsOrdered.push(row);
  }
  const used = new Set(rowsOrdered.map((r) => r.element));
  for (const row of rawRows) {
    if (!used.has(row.element)) rowsOrdered.push(row);
  }
  return rowsOrdered;
}

export default function ProjectExtractedTable({
  rows,
  elementsWithSection,
  extractedProjectText,
}: Props) {
  const getSectionForElement = useCallback(
    (elementName: string) => {
      const found = elementsWithSection.find((e) => e.title === elementName.trim());
      return found?.section ?? "—";
    },
    [elementsWithSection]
  );

  const elementDefs: ElementDef[] = elementsWithSection.map((e) => ({
    title: e.title,
    description: "",
    section: e.section,
  }));

  const rawRows: ProjectExtractedRow[] =
    rows.length > 0
      ? rows.map((r) => ({
          section: r.section ?? getSectionForElement(r.element),
          element: r.element,
          content: r.content,
          incomplete:
            r.incomplete ??
            (() => {
              const def = elementDefs.find((d) => d.title === r.element);
              return def ? isIncompleteElement(def, r.content) : !r.content.trim();
            })(),
        }))
      : [];

  const rowsWithSection = orderRows(rawRows, elementsWithSection);

  if (rowsWithSection.length === 0) {
    const t = extractedProjectText?.trim() || "";
    if (!t) return <span>Sube archivos del proyecto para ver aquí el texto extraído.</span>;
    return <pre className="whitespace-pre-wrap font-sans">{t}</pre>;
  }

  return (
    <table className="w-full border-collapse border border-gray-300 dark:border-gray-600">
      <thead>
        <tr className="bg-gray-100 dark:bg-gray-800">
          <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Sección</th>
          <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Elemento</th>
          <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Contenido</th>
          <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600 w-28">Estado</th>
        </tr>
      </thead>
      <tbody>
        {rowsWithSection.map((row, i) => {
          const incomplete = row.incomplete ?? !row.content.trim();
          return (
            <tr
              key={i}
              className={`border-b border-gray-200 dark:border-gray-700 ${incomplete ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
            >
              <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600">{row.section}</td>
              <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600">{row.element}</td>
              <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600 whitespace-pre-wrap">
                {row.content.trim() || <span className="italic text-amber-700 dark:text-amber-400">Vacío</span>}
              </td>
              <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600">
                {incomplete ? (
                  <span className="text-xs text-amber-700 dark:text-amber-400" title="No se pudo extraer contenido suficiente">
                    incompleto
                  </span>
                ) : (
                  <span className="text-xs text-green-700 dark:text-green-400" title="Contenido extraído">
                    ✓
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
