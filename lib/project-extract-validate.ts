import type { ElementDef } from "@/lib/excel-heuristics";
import { isLikelyGanttHeaderRowContent, isProjectNameElement } from "@/lib/excel-sheet-priority";
import { isSpecificObjectivesElement } from "@/lib/objective-extract";
import { isContinuityElement, isFormRowElement } from "@/lib/form-row-extract";

const LONG_FIELD_PATTERN =
  /objetivo|metodolog|presupuesto|actividad|cronograma|indicador|justificaci|descripci|plan\s+de|equipo|beneficiario/i;

const LIST_FIELD_PATTERN = /específico|actividad|indicador|objetivo/i;

/** Campos de metadata que suelen ser cortos (sede, escuela, nombre, etc.). */
const SHORT_METADATA_PATTERN =
  /sede|escuela|carrera|comuna|regi[oó]n|campus|facultad|nombre|t[ií]tulo|l[ií]der|correo|email|tel[eé]fono|fono|a[nñ]o|semestre|unidad/i;

/** Longitud mínima esperada para campos que suelen ser extensos. */
const MIN_LONG_FIELD_CHARS = 80;

/** Longitud mínima genérica cuando el contenido parece insuficiente. */
const MIN_GENERIC_CHARS = 25;

export function isShortMetadataElement(element: ElementDef): boolean {
  const combined = `${element.title} ${element.description}`;
  return SHORT_METADATA_PATTERN.test(combined);
}

export type ElementRowWithStatus = {
  section: string;
  element: string;
  content: string;
  incomplete?: boolean;
};

/**
 * Detecta si el contenido extraído parece vacío o incompleto para reintento.
 */
export function isIncompleteElement(element: ElementDef, content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || trimmed === "—") return true;

  if (isLikelyGanttHeaderRowContent(trimmed)) return true;

  if (isProjectNameElement(element)) {
    if (trimmed.length > 120) return true;
    if (/actividad|evidencias|tareas a realizar|descripcion de actividad/i.test(trimmed)) return true;
    if (trimmed.split(/\r?\n/).length >= 2) return true;
    if (trimmed.length < 2) return true;
    return false;
  }

  if (isSpecificObjectivesElement(element)) {
    const numberedLines = (trimmed.match(/^\s*\d+[\.\)]\s/mg) ?? []).length;
    const hasNumberedList = numberedLines >= 1;
    if (!hasNumberedList && trimmed.length < 60) return true;
    if (hasNumberedList && numberedLines === 1 && trimmed.length < 25) return true;
    if (trimmed.length < 15) return true;
    return false;
  }

  if (isContinuityElement(element)) {
    if (trimmed.length < 80) return true;
    if (/\(fila\s+\d+/i.test(trimmed)) return true;
    if (/¿El proyecto es continuidad/i.test(trimmed)) return true;
    return false;
  }

  if (isFormRowElement(element)) {
    if (trimmed.length < 40) return true;
    if (/\(fila\s+\d+/i.test(trimmed)) return true;
    return false;
  }

  const title = element.title.trim();
  const isLongField = LONG_FIELD_PATTERN.test(title) || LONG_FIELD_PATTERN.test(element.description);

  if (isLongField && trimmed.length < MIN_LONG_FIELD_CHARS) return true;

  if (LIST_FIELD_PATTERN.test(title) && trimmed.length < 50 && !/^\d+[\.\)]/m.test(trimmed)) {
    return true;
  }

  if (isShortMetadataElement(element)) {
    if (trimmed.length < 2) return true;
    return false;
  }

  if (trimmed.length < MIN_GENERIC_CHARS) return true;

  return false;
}

export function markIncompleteRows(
  rows: ElementRowWithStatus[],
  configElements: ElementDef[]
): ElementRowWithStatus[] {
  const defByTitle = new Map(configElements.map((e) => [e.title, e]));
  return rows.map((row) => {
    const def = defByTitle.get(row.element);
    const incomplete = def ? isIncompleteElement(def, row.content) : !row.content.trim();
    return { ...row, incomplete };
  });
}
