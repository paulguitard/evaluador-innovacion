import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRubricScoreSchema,
  subdimensionScoreKey,
} from "@/lib/evaluation-scores";
import {
  mergeAuthoritativeScores,
  parseScoresJsonPayload,
} from "@/lib/evaluation-scores-json";

const SAMPLE_RUBRIC = `----------Dimensión Novedad:-------------
Subdimensión "Grado de Originalidad de la Idea"
- Ponderación (25%)
- Nota 1: La idea presenta similitudes significativas.

Subdimensión "Estado del arte"
- Ponderación (15%)
- Nota 1: La propuesta muestra poca evidencia.
----------Dimensión Potencial de impacto:-------------
Subdimensión "Contribución Social, Ambiental o Productivo"
- Ponderación (20%)
- Nota 1: Sin impacto verificable en la comunidad o el entorno durante el periodo evaluado.

Subdimensión "Contribución en el Conocimiento"
- Ponderación (10%)
- Nota 1: No genera conocimiento nuevo ni evidencia de aprendizaje significativo.`;

describe("parseScoresJsonPayload", () => {
  const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);

  it("parsea subdimensionScores con claves exactas", () => {
    const key = subdimensionScoreKey("Novedad", "Grado de Originalidad de la Idea");
    const json = `{
      "subdimensionScores": {
        "${key}": 3,
        "${subdimensionScoreKey("Novedad", "Estado del arte")}": 2
      }
    }`;
    const { scores, missing } = parseScoresJsonPayload(json, schema);
    assert.equal(scores[key], 3);
    assert.ok(missing.length >= schema.length - 2);
  });

  it("parsea array scores con dimension y subdimension", () => {
    const json = `{
      "scores": [
        { "dimension": "Potencial de impacto", "subdimension": "Contribución en el Conocimiento", "score": 4 }
      ]
    }`;
    const key = subdimensionScoreKey("Potencial de impacto", "Contribución en el Conocimiento");
    const { scores } = parseScoresJsonPayload(json, schema);
    assert.equal(scores[key], 4);
  });

  it("rechaza notas fuera de rango", () => {
    const key = subdimensionScoreKey("Novedad", "Estado del arte");
    const json = `{ "subdimensionScores": { "${key}": 5 } }`;
    const { scores } = parseScoresJsonPayload(json, schema);
    assert.equal(scores[key], null);
  });

  it("extrae JSON dentro de fences markdown", () => {
    const key = subdimensionScoreKey("Novedad", "Estado del arte");
    const text = "```json\n{ \"subdimensionScores\": { \"" + key + "\": 2 } }\n```";
    const { scores } = parseScoresJsonPayload(text, schema);
    assert.equal(scores[key], 2);
  });
});

describe("mergeAuthoritativeScores", () => {
  const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);

  it("prioriza evaluación §5 sobre JSON", () => {
    const key = subdimensionScoreKey("Novedad", "Estado del arte");
    const evalScores = { [key]: 4 };
    const jsonScores = { [key]: 1 };
    const merged = mergeAuthoritativeScores(schema, jsonScores, [evalScores]);
    assert.equal(merged[key], 4);
  });

  it("usa JSON solo si las fuentes prioritarias no tienen la clave", () => {
    const key = subdimensionScoreKey("Novedad", "Estado del arte");
    const merged = mergeAuthoritativeScores(schema, { [key]: 3 }, [{}]);
    assert.equal(merged[key], 3);
  });

  it("usa fallback intermedio antes que JSON", () => {
    const key = subdimensionScoreKey("Novedad", "Estado del arte");
    const merged = mergeAuthoritativeScores(
      schema,
      { [key]: 1 },
      [{}, { [key]: 2 }]
    );
    assert.equal(merged[key], 2);
  });

  it("caso Beehappy: nota asignada Nota: 4 gana sobre JSON con 1 por criterio rúbrica", () => {
    const key = subdimensionScoreKey("Potencial de impacto", "Contribución en el Conocimiento");
    const evalScores = { [key]: 4 };
    const jsonScores = { [key]: 1 };
    const merged = mergeAuthoritativeScores(schema, jsonScores, [evalScores]);
    assert.equal(merged[key], 4);
  });
});
