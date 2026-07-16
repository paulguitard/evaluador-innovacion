import { isImet } from "./constants";

export const MANDATORY_RETRY_HINT_IGIP = `

IMPORTANTE: Este campo NO puede quedar vacío. Usa las herramientas para revisar todo el proyecto (hoja Resumen Proyecto, Gantt, Indicadores, PDF). Si no encuentras el texto exacto del título, busca por la descripción del elemento y sinónimos.`;

export const MANDATORY_RETRY_HINT_IMET = `

IMPORTANTE: Este campo NO puede quedar vacío. Revisa todas las hojas del formulario IMET (ficha, resumen, preguntas). Localiza la pregunta equivalente y extrae la respuesta; no confundas títulos de sección con respuestas del emprendedor.`;

const USER_PROMPT_BASE = `Elemento a extraer: "{{title}}"
Sección: {{section}}
Descripción de qué buscar: {{description}}
{{extraHints}}

Usa las herramientas para buscar en todo el proyecto. Cuando tengas suficiente información, responde con JSON {"content":"...","confidence":"high|medium|low"}.`;

export const DEFAULT_EXTRACT_USER_PROMPT_TEMPLATE_IGIP = `${USER_PROMPT_BASE}

Contexto IGIP: prioriza la hoja «Resumen Proyecto», Gantt/Cronograma e Indicadores. Distingue metadata (Sede, Escuelas) de campos narrativos del formulario.`;

export const DEFAULT_EXTRACT_USER_PROMPT_TEMPLATE_IMET = `${USER_PROMPT_BASE}

Contexto IMET: el formulario suele ser pregunta/respuesta en columnas. Empareja la pregunta con el elemento y extrae solo la respuesta del emprendedor.`;

/** Alias retrocompatible (IGIP). */
export const DEFAULT_EXTRACT_USER_PROMPT_TEMPLATE = DEFAULT_EXTRACT_USER_PROMPT_TEMPLATE_IGIP;

export const DEFAULT_DUPLICATE_RETRY_HINT_BODY_IGIP = `REINTENTO POR CONTENIDO DUPLICADO:
- El texto extraído para "{{elementTitle}}" coincide con el de: {{otherTitles}}.
- Eso suele ser un ERROR: cada elemento debe tener su propia respuesta del formulario.
- NO reutilices el párrafo duplicado. Busca la fila o sección del Excel que corresponde ÚNICAMENTE a "{{elementTitle}}".
- Texto duplicado detectado (referencia, no copies): "{{preview}}…"
- Si el campo es "Factor innovador del proyecto", usa la fila "Factor innovador" / "Diferenciación y propuesta de valor", NO la de continuidad de fases.
- Si el campo es "Continuidad de fases anteriores", describe solo la continuidad; no repitas el bloque de factor innovador si tiene fila propia.`;

export const DEFAULT_DUPLICATE_RETRY_HINT_BODY_IMET = `REINTENTO POR CONTENIDO DUPLICADO:
- El texto extraído para "{{elementTitle}}" coincide con el de: {{otherTitles}}.
- Eso suele ser un ERROR: cada pregunta del formulario IMET debe tener su propia respuesta.
- NO reutilices el párrafo duplicado. Localiza la fila o celda cuya pregunta corresponde ÚNICAMENTE a "{{elementTitle}}".
- Texto duplicado detectado (referencia, no copies): "{{preview}}…"
- No copies la respuesta de otro elemento aunque esté en la misma hoja; empareja pregunta y respuesta correctas.`;

/** Alias retrocompatible (IGIP). */
export const DEFAULT_DUPLICATE_RETRY_HINT_BODY = DEFAULT_DUPLICATE_RETRY_HINT_BODY_IGIP;

export const DEFAULT_VISION_INDEX_PROMPT_IGIP = `Extrae todo el texto visible del documento en la imagen. Preséntalo ordenado y estructurado con secciones claras, por ejemplo:
- Nombre del proyecto
- Objetivo general
- Objetivos específicos (numerados 1, 2, 3...)
- Otros datos relevantes (beneficiarios, equipo, fechas, etc.)

No inventes contenido. Respeta el orden y la numeración del documento original. Responde solo con el texto extraído, sin introducciones ni comentarios.`;

export const DEFAULT_VISION_INDEX_PROMPT_IMET = `Extrae todo el texto visible del documento en la imagen. Preséntalo ordenado y estructurado con secciones claras, por ejemplo:
- Nombre del emprendimiento
- Descripción breve del emprendimiento
- Segmento de clientes / modelo de negocio
- Avance actual u origen de la idea
- Otros datos del formulario IMET (preguntas y respuestas)

No inventes contenido. Respeta el orden del documento original. Responde solo con el texto extraído, sin introducciones ni comentarios.`;

/** Alias retrocompatible (IGIP). */
export const DEFAULT_VISION_INDEX_PROMPT = DEFAULT_VISION_INDEX_PROMPT_IGIP;

export const DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP = `Eres un asistente que estructura la carta Gantt / plan de actividades de proyectos IGIP.

Recibirás datos de la hoja Excel con nombres y descripciones de actividades.

REGLAS OBLIGATORIAS:
- Lista numerada (1, 2, 3…) con una actividad por bloque.
- Cada actividad incluye ÚNICAMENTE:
  • Nombre de la actividad
  • Descripción de la actividad
- NO incluyas: tareas, subtareas, responsables, fechas, duración, % avance, evidencias ni columnas extra.
- NO copies párrafos de desarrollo técnico ni texto de otras hojas.
- NO inventes actividades; solo usa los datos proporcionados.
- Omite encabezados de tabla, filas vacías y filas de subtareas ("Tareas:").
- Respeta la descripción del elemento configurada por el usuario.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

export const DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP = `Eres un asistente que estructura tablas de indicadores de proyectos IGIP.

Recibirás datos crudos de la hoja Excel "Indicadores" (filas con etiquetas de columna).
Tu tarea es reescribirlos de forma clara y legible para un evaluador humano.

REGLAS DE FORMATO:
- Un bloque numerado por cada indicador (1, 2, 3…).
- Dentro de cada bloque usa etiquetas en líneas separadas.
- NO uses pipes (|), tablas de una sola línea ni listas compactas ilegibles.
- NO inventes datos; solo reorganiza fielmente lo que aparece en los datos crudos.
- Omite campos vacíos.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

/** IMET rara vez usa Gantt; prompt genérico por si un elemento lo requiere. */
export const DEFAULT_GANTT_STRUCTURE_PROMPT_IMET = `Eres un asistente que estructura listas de actividades de emprendimientos IMET.

Recibirás datos de una hoja Excel con nombres y descripciones de actividades.

REGLAS:
- Lista numerada (1, 2, 3…) con una actividad por bloque.
- Cada actividad: nombre y descripción únicamente.
- NO inventes actividades; solo usa los datos proporcionados.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

export const DEFAULT_INDICATORS_STRUCTURE_PROMPT_IMET = `Eres un asistente que estructura tablas de indicadores de emprendimientos IMET.

Recibirás datos crudos de una hoja Excel con indicadores.
Reescríbelos en bloques numerados legibles para un evaluador.

REGLAS:
- Un bloque por indicador (1, 2, 3…).
- NO inventes datos; solo reorganiza lo que aparece.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}`;

/** Alias retrocompatible (IGIP). */
export const DEFAULT_GANTT_STRUCTURE_PROMPT = DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP;
export const DEFAULT_INDICATORS_STRUCTURE_PROMPT = DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP;

export const IGIP_SHEET_PATTERN_RESUMEN = "resumen|ficha|informaci[oó]n\\s*general";
export const IMET_SHEET_PATTERN_RESUMEN =
  "resumen|ficha|imet|informaci[oó]n\\s*general|formulario";

const AGENT_NUMERIC_DEFAULTS = {
  maxToolIterations: 5,
  maxTokens: 4096,
  temperature: 0.15,
  fallbackTopK: 16,
  fallbackMaxRetrievedChars: 20_000,
  toolSearchTopK: 18,
  toolSearchMaxRetrievedChars: 22_000,
};

export function extractAgentConfigForType(typeName?: string | null) {
  return {
    ...AGENT_NUMERIC_DEFAULTS,
    userPromptTemplate: isImet(typeName)
      ? DEFAULT_EXTRACT_USER_PROMPT_TEMPLATE_IMET
      : DEFAULT_EXTRACT_USER_PROMPT_TEMPLATE_IGIP,
  };
}

export function extractDuplicateGuardConfigForType(typeName?: string | null) {
  return {
    minCompareChars: 80,
    similarityThreshold: 0.92,
    retryHintBody: isImet(typeName)
      ? DEFAULT_DUPLICATE_RETRY_HINT_BODY_IMET
      : DEFAULT_DUPLICATE_RETRY_HINT_BODY_IGIP,
  };
}

export function extractVisionConfigForType(typeName?: string | null) {
  return {
    indexPrompt: isImet(typeName)
      ? DEFAULT_VISION_INDEX_PROMPT_IMET
      : DEFAULT_VISION_INDEX_PROMPT_IGIP,
  };
}

export function extractStructurePromptsForType(typeName?: string | null) {
  if (isImet(typeName)) {
    return {
      gantt: DEFAULT_GANTT_STRUCTURE_PROMPT_IMET,
      indicators: DEFAULT_INDICATORS_STRUCTURE_PROMPT_IMET,
    };
  }
  return {
    gantt: DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP,
    indicators: DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP,
  };
}

export function extractSheetPatternsForType(typeName?: string | null) {
  return {
    gantt: "gantt|cronograma|carta\\s*gantt|plan\\s+de\\s+actividad",
    indicators: "indicador",
    resumen: isImet(typeName) ? IMET_SHEET_PATTERN_RESUMEN : IGIP_SHEET_PATTERN_RESUMEN,
  };
}

/** Bloque de prompts y patrones que varían entre IGIP e IMET. */
export function buildExtractTypeSpecificDefaults(typeName?: string | null) {
  return {
    sheetPatterns: extractSheetPatternsForType(typeName),
    structurePrompts: extractStructurePromptsForType(typeName),
    agent: extractAgentConfigForType(typeName),
    duplicateGuard: extractDuplicateGuardConfigForType(typeName),
    vision: extractVisionConfigForType(typeName),
    hintOverrides: defaultExtractHintOverrides(),
  };
}

export function defaultExtractAgentConfig() {
  return extractAgentConfigForType("IGIP");
}

export function defaultExtractProjectIndexConfig() {
  return {
    chunkSizeChars: 900,
    overlapChars: 120,
  };
}

export function defaultExtractProjectRetrieveConfig() {
  return {
    topK: 15,
    maxRetrievedChars: 18_000,
    neighborWindow: 1,
  };
}

export function defaultExtractDuplicateGuardConfig() {
  return extractDuplicateGuardConfigForType("IGIP");
}

export function defaultExtractRetryConfig() {
  return {
    emptyRetryExtraTimeoutMs: 20_000,
  };
}

export function defaultExtractHeuristicConfig() {
  return {
    highConfidenceMin: 0.72,
    minUsableConfidence: 0.55,
  };
}

export function defaultExtractVisionConfig() {
  return extractVisionConfigForType("IGIP");
}

export function defaultExtractHintOverrides() {
  return {
    mandatoryRetryIgip: MANDATORY_RETRY_HINT_IGIP.trim(),
    mandatoryRetryImet: MANDATORY_RETRY_HINT_IMET.trim(),
  };
}

/** Reglas documentadas (hardcodeadas en extract-hints.ts). */
export const EXTRACT_TYPE_HINTS_REFERENCE: {
  type: "IGIP" | "IMET";
  trigger: string;
  summary: string;
}[] = [
  {
    type: "IGIP",
    trigger: "Título: necesidad / problema / oportunidad",
    summary: "Fila «Necesidad, problema u oportunidad» en Resumen Proyecto.",
  },
  {
    type: "IGIP",
    trigger: "Solución / nivel de avance",
    summary: "Distinguir planificado vs ejecutado; filas de avance en Resumen Proyecto.",
  },
  {
    type: "IGIP",
    trigger: "Ejes de impacto / focalización",
    summary: "No usar metadata «Focalización»; buscar pregunta narrativa.",
  },
  {
    type: "IGIP",
    trigger: "Factor innovador / escalabilidad / ODS",
    summary: "Respuesta del formulario, no la pregunta; no copiar continuidad.",
  },
  {
    type: "IGIP",
    trigger: "Actividades Gantt / Indicadores",
    summary: "Hojas Gantt o Indicadores con formato estructurado.",
  },
  {
    type: "IMET",
    trigger: "Nombre del proyecto",
    summary: "Respuesta a «¿Cuál es el nombre de tu emprendimiento?».",
  },
  {
    type: "IMET",
    trigger: "Avance actual / origen de la idea",
    summary: "Pares pregunta/respuesta en columnas del formulario IMET.",
  },
  {
    type: "IMET",
    trigger: "Segmento / modelo de negocio / validación",
    summary: "Localizar pregunta equivalente y extraer solo la respuesta.",
  },
];
