/** Defaults de system/user prompts editables (override vacío → usar estos). */

export const DEFAULT_EXTRACT_SYSTEM_PROMPT = `Eres un extractor de información de proyectos de innovación.

Tu tarea es identificar y redactar el contenido de UN elemento concreto del proyecto, usando las herramientas para buscar en todo el documento.

Reglas:
- Usa el título y la descripción del elemento como guía semántica (no busques solo coincidencia literal del título).
- Busca en todo el proyecto: tablas, párrafos, secciones y hojas Excel.
- En bitácoras Excel IGIP, revisa get_structured_excel en la hoja "Resumen Proyecto": metadata (Sede, Escuelas, Carreras) en filas superiores de columnas A/B; campos narrativos en filas inferiores del mismo formulario.
- El valor de metadata suele estar en la celda adyacente a la etiqueta.
- Puedes sintetizar información dispersa en varias partes del documento.
- Prioriza fidelidad al documento; no inventes datos que no aparezcan en las fuentes.
- Para nivel de avance: no confundas fases planificadas con ejecución real; respeta expresiones como "nace desde cero" o "sin financiamiento previo".
- Si no hay evidencia suficiente, devuelve content vacío.
- Cuando termines de buscar, responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

export const DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET = `Eres un extractor de información de emprendimientos / proyectos IMET.

Tu tarea es identificar y redactar el contenido de UN elemento concreto, usando las herramientas para buscar en todo el documento.

Reglas:
- Usa el título y la descripción del elemento como guía semántica.
- Los formularios IMET suelen ser pregunta/respuesta: localiza la pregunta y extrae la respuesta asociada.
- Prioriza hojas de ficha o resumen; no confundas títulos de sección con respuestas del emprendedor.
- Busca en tablas, párrafos, secciones y hojas Excel; no inventes datos.
- Si no hay evidencia suficiente, devuelve content vacío.
- Cuando termines de buscar, responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

/** Plantilla user de evaluación por subdimensión (IGIP). Placeholders: {{dimension}}, {{subdimension}}, {{scoreExamples}}, {{knowledgeLabel}}, {{phaseInstructions}} */
export const DEFAULT_SUBDIMENSION_USER_PROMPT = `Evalúa la subdimensión "{{subdimension}}" dentro de la dimensión "{{dimension}}".

Metodología:
1. Interpreta los criterios de la subdimensión y qué conlleva cada nota ({{scoreExamples}}).
2. Localiza en los elementos del proyecto la información que se refiere a "{{subdimension}}".
3. Con el marco teórico de {{knowledgeLabel}} (Knowledge), asigna la nota y redacta análisis, justificación y mejoras.

Usa ÚNICAMENTE:
- Los elementos identificados del proyecto en "Documentos del proyecto a evaluar".
- Los fragmentos de {{knowledgeLabel}} (Knowledge) incluidos en el contexto.
- Los criterios de la subdimensión en "Enfoque de esta evaluación parcial".

Incluye obligatoriamente estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
1. **Análisis** — evaluación rigurosa del proyecto según los criterios
2. **Nota** — OBLIGATORIO e INNEGOCIABLE:
   - Una línea exacta con el formato: Nota: N
   - N debe ser un único dígito: {{scoreExamples}} (número arábigo, no palabras)
   - Prohibido omitir la nota, usar rangos, decimales o frases como "nota alta"
3. **Justificación** — fundamentada en el Knowledge y la evidencia del proyecto
4. **Posibles mejoras** — propuestas concretas y accionables

La línea "Nota: N" debe aparecer en su propia línea, después del Análisis y antes de la Justificación.
Ejemplo válido:
**Análisis**
(texto del análisis)

Nota: 3

**Justificación**
(texto)

Profundiza con detalle técnico del proyecto y del marco teórico sin inventar hechos.
{{phaseInstructions}}

No uses etiquetas <think>. Responde solo con la evaluación de esta subdimensión.`;

export const DEFAULT_EVAL_SYSTEM_FALLBACK =
  "Eres un evaluador de proyectos de innovación. Responde solo con la evaluación solicitada, íntegramente en español, sin etiquetas <think>.";

export const DEFAULT_VARIABLE_EVAL_USER_PROMPT = `Evalúa la variable/perspectiva "{{variable}}" del proyecto.

Metodología:
1. Interpreta los criterios de cada nivel para esta perspectiva ({{levelNumbers}}).
2. Localiza en los elementos del proyecto la evidencia relevante para "{{variable}}".
3. Con el marco teórico de {{knowledgeLabel}} (Knowledge), asigna el nivel y redacta análisis y justificación.

Incluye obligatoriamente estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
1. **Análisis** — evaluación rigurosa del proyecto según los criterios de esta variable
2. **Nivel asignado** — OBLIGATORIO:
   - Una línea exacta con el formato: Nivel: N
   - N debe ser uno de: {{levelNumbers}}
3. **Justificación** — fundamentada en el Knowledge y la evidencia del proyecto

La línea "Nivel: N" debe aparecer en su propia línea, después del Análisis y antes de la Justificación.
{{phaseInstructions}}

No uses etiquetas <think>. Responde solo con la evaluación de esta variable.`;

export const DEFAULT_ASSIGN_LEVEL_USER_PROMPT = `Asigna UN ÚNICO nivel global al proyecto según la escala de niveles.

Escala principal de referencia:
{{mainScale}}

Metodología:
1. Lee los criterios de cada nivel en la rúbrica.
2. Contrasta con los elementos del proyecto y {{knowledgeLabel}} (Knowledge).
3. Elige el nivel que mejor describe el estado actual del proyecto.

REGLAS:
- Responde con estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
  1. **Análisis** — evidencia del proyecto respecto a los criterios
  2. **Nivel asignado** — una línea exacta: Nivel: N (donde N es uno de: {{levelNumbers}})
  3. **Justificación** — por qué ese nivel y no otro adyacente

La línea "Nivel: N" debe estar en su propia línea.
No uses etiquetas <think>.
{{phaseInstructions}}`;

export const DEFAULT_GLOBAL_LEVEL_USER_PROMPT = `Con las evaluaciones por variable, asigna UN ÚNICO nivel global al proyecto.

Resumen de variables:
{{variableSummary}}

Nivel mayoritario sugerido: {{majorityLevel}}

Escala válida: {{levelNumbers}}
Knowledge: {{knowledgeLabel}}

Responde con:
1. **Análisis** — síntesis de las perspectivas
2. **Nivel asignado** — línea exacta: Nivel: N
3. **Justificación**

{{phaseInstructions}}
No uses etiquetas <think>.`;

export function applyPromptTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out.trim();
}

/** Texto opcional para {{phaseInstructions}} en plantillas user de evaluación (sin encabezado redundante). */
export function formatOptionalPhaseInstructions(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `\n\n${trimmed}` : "";
}
