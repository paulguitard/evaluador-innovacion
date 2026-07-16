import type { RubricScoreSchemaEntry } from "@/lib/evaluation-scores";
import { subdimensionScoreKey } from "@/lib/evaluation-scores";

export type ScoresJsonParseResult = {
  scores: Record<string, number | null>;
  missing: string[];
};

function stripJsonFences(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(t);
  if (fenced) return fenced[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}

function normalizeScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4) {
    return value;
  }
  if (typeof value === "string") {
    const n = parseInt(value.trim(), 10);
    if (n >= 1 && n <= 4) return n;
  }
  return null;
}

function schemaKeySet(schema: RubricScoreSchemaEntry[]): Set<string> {
  return new Set(schema.map((e) => e.key));
}

function resolveKey(
  schema: RubricScoreSchemaEntry[],
  dimension: string | undefined,
  name: string | undefined,
  explicitKey: string | undefined
): string | null {
  if (explicitKey && schema.some((e) => e.key === explicitKey)) return explicitKey;
  if (dimension && name) {
    const key = subdimensionScoreKey(dimension, name);
    if (schema.some((e) => e.key === key)) return key;
  }
  if (name) {
    const match = schema.find((e) => e.name === name);
    if (match) return match.key;
  }
  return null;
}

/** Parsea respuesta LLM con notas estructuradas. */
export function parseScoresJsonPayload(
  text: string,
  schema: RubricScoreSchemaEntry[]
): ScoresJsonParseResult {
  const validKeys = schemaKeySet(schema);
  const scores: Record<string, number | null> = {};
  for (const entry of schema) scores[entry.key] = null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    return { scores, missing: schema.map((e) => e.key) };
  }

  if (!parsed || typeof parsed !== "object") {
    return { scores, missing: schema.map((e) => e.key) };
  }

  const obj = parsed as Record<string, unknown>;

  const mapObj = obj.subdimensionScores ?? obj.scores;
  if (mapObj && typeof mapObj === "object" && !Array.isArray(mapObj)) {
    for (const [key, val] of Object.entries(mapObj as Record<string, unknown>)) {
      if (!validKeys.has(key)) continue;
      const score = normalizeScore(val);
      if (score != null) scores[key] = score;
    }
  }

  if (Array.isArray(obj.scores)) {
    for (const row of obj.scores) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const key = resolveKey(
        schema,
        typeof r.dimension === "string" ? r.dimension : undefined,
        typeof r.subdimension === "string"
          ? r.subdimension
          : typeof r.name === "string"
            ? r.name
            : undefined,
        typeof r.key === "string" ? r.key : undefined
      );
      if (!key) continue;
      const score = normalizeScore(r.score ?? r.nota ?? r.value);
      if (score != null) scores[key] = score;
    }
  }

  const missing = schema.filter((e) => scores[e.key] == null).map((e) => e.key);
  return { scores, missing };
}

function buildSchemaListForPrompt(schema: RubricScoreSchemaEntry[]): string {
  return schema
    .map((e) => `- "${e.key}" (dimensión: ${e.dimension}, subdimensión: ${e.name})`)
    .join("\n");
}

/** System prompt por defecto al extraer notas numéricas del borrador (IGIP). */
export function buildDefaultScoreJsonSystemPrompt(
  indicatorLabel = "IGIP",
  options?: { scoreMin?: number; scoreMax?: number }
): string {
  const label = indicatorLabel.trim() || "IGIP";
  const min = options?.scoreMin ?? 1;
  const max = options?.scoreMax ?? 4;
  return `Eres un extractor de notas de evaluación ${label}. Tu única tarea es leer los análisis por subdimensión y devolver un JSON con la nota numérica asignada (${min} a ${max}) a cada subdimensión.

REGLAS:
- Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional.
- Usa exactamente las claves indicadas en "subdimensionScores".
- Cada valor debe ser un entero entre ${min} y ${max}.
- Extrae la nota del veredicto evaluativo en cada bloque "### Subdimensión:"; no inventes notas.
- La nota asignada es la línea "Nota: N" (o **Nota** seguida de N) dentro del análisis del evaluador.
- IGNORA las líneas de criterio de rúbrica con formato "- Nota N: descripción..."; esas describen la escala, NO la nota asignada al proyecto.
- Si hay ambigüedad, infiere la nota más coherente con el análisis y la justificación del evaluador.`;
}

export function buildScoresExtractionMessages(
  schema: RubricScoreSchemaEntry[],
  rawEvaluation: string,
  options?: { indicatorLabel?: string; scoreJsonSystem?: string; scoreMin?: number; scoreMax?: number }
): { role: "system" | "user"; content: string }[] {
  const label = options?.indicatorLabel ?? "IGIP";
  const min = options?.scoreMin ?? 1;
  const max = options?.scoreMax ?? 4;
  const keysExample = schema
    .slice(0, 2)
    .map((e) => `    "${e.key}": 3`)
    .join(",\n");

  const defaultSystem = buildDefaultScoreJsonSystemPrompt(label, { scoreMin: min, scoreMax: max });

  return [
    {
      role: "system",
      content: options?.scoreJsonSystem?.trim() || defaultSystem,
    },
    {
      role: "user",
      content: `Subdimensiones requeridas (claves exactas):
${buildSchemaListForPrompt(schema)}

Formato de respuesta (ejemplo de estructura):
{
  "subdimensionScores": {
${keysExample}
  }
}

Análisis de evaluación por subdimensión:
${rawEvaluation.slice(0, 28000)}`,
    },
  ];
}

export function buildScoresExtractionRetryMessages(
  schema: RubricScoreSchemaEntry[],
  rawEvaluation: string,
  missingKeys: string[],
  partial: Record<string, number | null>,
  indicatorLabel = "IGIP"
): { role: "system" | "user"; content: string }[] {
  const missingList = missingKeys
    .map((key) => {
      const entry = schema.find((e) => e.key === key);
      return entry ? `- "${key}" (${entry.name})` : `- "${key}"`;
    })
    .join("\n");

  const partialLines = Object.entries(partial)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `  "${k}": ${v}`)
    .join(",\n");

  return [
    {
      role: "system",
      content:
        `Completa el JSON de notas ${indicatorLabel}. Responde SOLO JSON válido con TODAS las claves en subdimensionScores.`,
    },
    {
      role: "user",
      content: `Faltan notas para estas subdimensiones:
${missingList}

Notas ya extraídas (consérvalas):
{
  "subdimensionScores": {
${partialLines}
  }
}

Análisis completo:
${rawEvaluation.slice(0, 28000)}

Devuelve el JSON completo con las ${schema.length} subdimensiones y notas 1-4.`,
    },
  ];
}

export type LlmCompleteFn = (
  messages: { role: "system" | "user"; content: string }[]
) => Promise<string>;

/** Extrae notas vía LLM + JSON (fuente autoritativa para la tabla). */
export async function extractSubdimensionScoresViaJson(
  schema: RubricScoreSchemaEntry[],
  rawEvaluation: string,
  complete: LlmCompleteFn,
  options?: { indicatorLabel?: string; scoreJsonSystem?: string; scoreMin?: number; scoreMax?: number }
): Promise<Record<string, number | null>> {
  if (schema.length === 0) return {};

  const label = options?.indicatorLabel ?? "IGIP";
  let { scores, missing } = parseScoresJsonPayload(
    await complete(buildScoresExtractionMessages(schema, rawEvaluation, options)),
    schema
  );

  if (missing.length > 0) {
    const retryText = await complete(
      buildScoresExtractionRetryMessages(schema, rawEvaluation, missing, scores, label)
    );
    const retry = parseScoresJsonPayload(retryText, schema);
    scores = { ...scores, ...retry.scores };
    missing = schema.filter((e) => scores[e.key] == null).map((e) => e.key);
  }

  return scores;
}

/** Fuentes en orden de prioridad (fallbacks); jsonScores solo rellena claves aún null. */
export function mergeAuthoritativeScores(
  schema: RubricScoreSchemaEntry[],
  jsonScores: Record<string, number | null>,
  fallbacks: Record<string, number | null>[]
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const entry of schema) {
    let score: number | null = null;
    for (const fb of fallbacks) {
      if (fb[entry.key] != null) {
        score = fb[entry.key];
        break;
      }
    }
    if (score == null) {
      score = jsonScores[entry.key] ?? null;
    }
    out[entry.key] = score;
  }
  return out;
}
