import type { ElementDef } from "@/lib/excel-heuristics";
import { isGanttActivitiesElement } from "@/lib/sheet-element-routing";
import { fixedKeyFor, type FixedEvalTypeKey } from "./constants";
import {
  MANDATORY_RETRY_HINT_IGIP,
  MANDATORY_RETRY_HINT_IMET,
} from "./extract-config-defaults";

type MandatoryRetryOverrides = {
  mandatoryRetryIgip?: string;
  mandatoryRetryImet?: string;
};
export function getMandatoryRetryHint(
  typeName?: string | null,
  overrides?: MandatoryRetryOverrides
): string {
  if (fixedKeyFor(typeName) === "IMET") {
    return overrides?.mandatoryRetryImet?.trim() || MANDATORY_RETRY_HINT_IMET;
  }
  return overrides?.mandatoryRetryIgip?.trim() || MANDATORY_RETRY_HINT_IGIP;
}

function isSolutionAdvanceElement(element: ElementDef): boolean {
  const t = `${element.title} ${element.description}`.toLowerCase();
  return /consiste la soluci|nivel de avance|grado de avance|avance actual/.test(t);
}

function elementText(element: ElementDef): string {
  return `${element.title} ${element.section ?? ""} ${element.description}`.toLowerCase();
}

/** Pistas por título/descripción específicas de bitácoras IGIP. */
export function getIgipElementHints(element: ElementDef): string[] {
  const hints: string[] = [];
  const t = elementText(element);

  if (/necesidad|problema|oportunidad/i.test(element.title)) {
    hints.push(
      'Busca la fila cuya etiqueta contiene "Necesidad, problema u oportunidad". El texto puede ocupar varias columnas fusionadas en la hoja "Resumen Proyecto".'
    );
  }

  if (isSolutionAdvanceElement(element)) {
    hints.push(
      'Busca la fila cuya etiqueta contiene "En qué consiste la solución", "nivel de avance" o "qué avances has logrado" en Resumen Proyecto o columna de preguntas.'
    );
    hints.push(
      `Reglas para nivel de avance:
- Busca la fila "En qué consiste la solución", "qué avances has logrado" o similar.
- Distingue lo PLANIFICADO de lo YA EJECUTADO.
- Si el documento dice "nace desde cero" o que aún no ha iniciado, repórtalo así.
- Transcribe o sintetiza fielmente lo que dice el documento sobre la solución y el avance actual.`
    );
  }

  if (/ejes?\s+de\s+impacto|focalizaci/.test(t)) {
    hints.push(
      'No uses la fila metadata "Focalización". Busca la pregunta narrativa "Ejes de impacto o focalizaciones" en Resumen Proyecto.'
    );
  }
  if (/sostenibilidad|objetivo de desarrollo sostenible|\bods\b/.test(t)) {
    hints.push("Extrae la RESPUESTA del proyecto, no la pregunta del formulario.");
  }
  if (/factor innovador/.test(t)) {
    hints.push(
      'Usa la fila "Factor innovador del proyecto" / "Diferenciación y propuesta de valor" en Seguimiento o Resumen Proyecto.'
    );
    hints.push(
      "NO copies el texto de Continuidad de fases anteriores. Son campos distintos con respuestas distintas."
    );
  }
  if (/escalabilidad/.test(t)) {
    hints.push(
      "Responde si existen planes de expansión o replicación; no copies las preguntas del formulario."
    );
  }
  if (isGanttActivitiesElement(element)) {
    hints.push(
      element.description ||
        "Lista solo nombre y descripción de cada actividad desde la hoja Gantt/Cronograma."
    );
  }
  if (/^indicador/.test(element.title.toLowerCase()) || (t.includes("indicador") && !/metodolog/.test(t))) {
    hints.push(
      'Usa la hoja "Indicadores". Estructura cada indicador en bloques numerados con etiquetas claras.'
    );
  }

  return hints;
}

/** Pistas por título/descripción específicas de formularios IMET. */
export function getImetElementHints(element: ElementDef): string[] {
  const hints: string[] = [];
  const t = elementText(element);

  if (/avance actual/i.test(element.title)) {
    hints.push(
      "En formularios IMET (columna pregunta / columna respuesta), busca la pregunta sobre avances logrados hasta ahora."
    );
  }

  if (/nombre del proyecto/i.test(element.title)) {
    hints.push(
      'En formularios IMET, el nombre suele estar en la respuesta a "¿Cuál es el nombre de tu emprendimiento?". No uses la pregunta "Describe brevemente tu emprendimiento".'
    );
  }

  if (/origen de la idea|descripci.*emprendimiento/i.test(`${element.title} ${element.description}`)) {
    hints.push(
      "En Excel tipo IMET (pregunta en columna A, respuesta en columna B), empareja la pregunta con el elemento y extrae solo la respuesta."
    );
  }

  if (/segmento|validaci|modelo de negocio|componente tecnol/.test(t)) {
    hints.push(
      "Localiza la pregunta del formulario que corresponde al elemento y extrae únicamente la respuesta del emprendedor."
    );
  }

  return hints;
}

export function getTypeElementHints(element: ElementDef, typeName?: string | null): string[] {
  const key: FixedEvalTypeKey = fixedKeyFor(typeName);
  return key === "IMET" ? getImetElementHints(element) : getIgipElementHints(element);
}

/**
 * Pistas adicionales para el prompt user del extractor LLM (no incluye system prompt).
 * Orden: pistas por tipo → hints opcionales del elemento.
 */
export function buildElementLlmHints(
  element: ElementDef,
  typeName?: string | null
): string {
  const hints: string[] = [...getTypeElementHints(element, typeName)];

  if (element.extractStrategy?.llmHints?.trim()) {
    hints.push(element.extractStrategy.llmHints.trim());
  }

  if (hints.length === 0) return "";
  return "\n\nPistas adicionales:\n" + hints.map((h) => `- ${h}`).join("\n");
}
