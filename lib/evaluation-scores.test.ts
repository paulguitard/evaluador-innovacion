import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backfillSubdimensionScores,
  buildDeterministicEvaluationSummary,
  buildDeterministicLevelsEvaluationSummary,
  buildRubricScoreSchema,
  computeWeightedIndicatorScore,
  finalizeEvaluationSummary,
  formatIndicatorScore,
  injectAuthoritativeScoresSection,
  isProjectDescriptionSummary,
  listSubdimensionSections,
  parseSubdimensionScore,
  repairFormattedReportFromRaw,
  shouldRepairFormattedReport,
  parseSubdimensionWeight,
  subdimensionScoreKey,
  subdimensionNamesMatch,
  truncateSummary,
} from "@/lib/evaluation-scores";

const NOVEDAD_BLOCK = `Subdimensión "Grado de Originalidad de la Idea"
- Ponderación (25%)
- Nota 1: La idea presenta similitudes significativas.

Subdimensión "Estado del arte"
- Ponderación (15%)
- Nota 1: La propuesta muestra poca evidencia.`;

const SAMPLE_RUBRIC = `----------Dimensión Novedad:-------------
${NOVEDAD_BLOCK}
----------Dimensión Potencial de impacto:-------------
Subdimensión "Contribución Social, Ambiental o Productivo"
- Ponderación (20%)
- Nota 1: Sin impacto.`;

describe("parseSubdimensionWeight", () => {
  it("extrae porcentaje de ponderación", () => {
    assert.equal(parseSubdimensionWeight("- Ponderación (25%)\n"), 25);
    assert.equal(parseSubdimensionWeight("Ponderación (12.5%)"), 12.5);
    assert.equal(parseSubdimensionWeight("sin peso"), null);
  });
});

describe("parseSubdimensionScore", () => {
  it("parsea variantes de nota 1-4", () => {
    assert.equal(parseSubdimensionScore("**Nota**: 3\nJustificación…"), 3);
    assert.equal(parseSubdimensionScore("Nota: 4"), 4);
    assert.equal(parseSubdimensionScore("Nota asignada: 2"), 2);
    assert.equal(parseSubdimensionScore("Calificación: 3"), 3);
    assert.equal(parseSubdimensionScore("**Nota**\n2\nJustificación"), 2);
    assert.equal(parseSubdimensionScore("Análisis sin nota"), null);
    assert.equal(parseSubdimensionScore("Nota: 5"), null);
  });

  it("prefiere la última línea Nota cuando el análisis menciona otras cifras", () => {
    const text = `**Análisis**
En escala 1-4 podría ser nota 2 por similitud con el estado del arte.

**Nota**: 3

**Justificación**
Por encima del mínimo.`;
    assert.equal(parseSubdimensionScore(text), 3);
  });
});

describe("subdimensionNamesMatch", () => {
  it("empareja nombres con variaciones de puntuación", () => {
    assert.equal(
      subdimensionNamesMatch(
        "Contribución Social, Ambiental o Productivo",
        "Contribución Social Ambiental o Productivo"
      ),
      true
    );
  });
});

describe("listSubdimensionSections", () => {
  it("detecta secciones numeradas del informe IGIP", () => {
    const report = `3.1 Subdimensión Contribución Social, Ambiental o Productivo (Análisis, nota…)
**Análisis**
Texto.

**Nota**: 3

**Justificación**
Más texto.`;
    const sections = listSubdimensionSections(report);
    const contrib = sections.find((s) => s.name.includes("Contribución"));
    assert.ok(contrib);
    assert.equal(parseSubdimensionScore(contrib!.body), 3);
  });
});

describe("backfillSubdimensionScores", () => {
  it("recupera nota desde informe formateado si faltó en análisis crudo", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const estado = schema.find((s) => s.name.toLowerCase().includes("estado"));
    if (!estado) return;
    const report = `### Subdimensión: ${estado.name}\n\n**Análisis**\nTexto.\n\n**Nota**: 3\n\n**Justificación**\nTexto.`;
    const scores: Record<string, number | null> = { [estado.key]: null };
    const filled = backfillSubdimensionScores(schema, scores, [report]);
    assert.equal(filled[estado.key], 3);
  });

  it("recupera Contribución Social desde informe con encabezado numerado", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const contrib = schema.find((s) => s.name.includes("Contribución"));
    if (!contrib) return;
    const report = `3.1 Subdimensión Contribución Social, Ambiental o Productivo
**Análisis**
Impacto moderado.

Nota: 2

**Justificación**
Limitado alcance.`;
    const scores: Record<string, number | null> = { [contrib.key]: null };
    const filled = backfillSubdimensionScores(schema, scores, [report]);
    assert.equal(filled[contrib.key], 2);
  });
});

describe("finalizeEvaluationSummary", () => {
  it("rechaza resumen del proyecto y usa síntesis determinista", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const e of schema) scores[e.key] = 3;
    const bad = "**1. Resumen del proyecto** El proyecto X tiene como objetivo…";
    const result = finalizeEvaluationSummary(bad, schema, scores, 3);
    assert.equal(isProjectDescriptionSummary(bad), true);
    assert.ok(!/resumen del proyecto/i.test(result));
    assert.ok(/Evaluación IGIP/i.test(result));
  });

  it("usa indicatorLabel configurable", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const e of schema) scores[e.key] = 2;
    const bad = "**1. Resumen del proyecto** El proyecto X…";
    const result = finalizeEvaluationSummary(bad, schema, scores, 2, "TRL");
    assert.ok(/Evaluación TRL/i.test(result));
    assert.ok(!/Evaluación IGIP/i.test(result));
  });

  it("acepta síntesis evaluativa válida del LLM", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const e of schema) scores[e.key] = 2;
    const good = "Evaluación IGIP con debilidades en originalidad y estado del arte; nota global 2.";
    const result = finalizeEvaluationSummary(good, schema, scores, 2);
    assert.equal(result, good);
  });
});

describe("buildDeterministicEvaluationSummary", () => {
  it("incluye nota global y fortalezas/debilidades", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const e of schema) {
      scores[e.key] = e.name.includes("Originalidad") ? 4 : 2;
    }
    const text = buildDeterministicEvaluationSummary(schema, scores, 2.8);
    assert.ok(/Evaluación IGIP/i.test(text));
    assert.ok(/Fortalezas/i.test(text));
    assert.ok(/Debilidades/i.test(text));
  });
});

describe("buildDeterministicLevelsEvaluationSummary", () => {
  it("resume nivel y justificación para IMET", () => {
    const raw = `**Análisis** Evidencia del prototipo.

Nivel: 3

**Justificación** El proyecto cumple criterios de nivel 3 por contar con plataforma funcional lista para validación.`;
    const text = buildDeterministicLevelsEvaluationSummary(
      3,
      "Prototipo funcional",
      "IMET",
      raw,
      1000
    );
    assert.match(text, /nivel 3/i);
    assert.match(text, /Prototipo funcional/i);
    assert.match(text, /justificaci/i);
    assert.doesNotMatch(text, /subdimensi/i);
  });
});

describe("computeWeightedIndicatorScore", () => {
  it("calcula promedio ponderado cuando hay todas las notas", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const entry of schema) {
      scores[entry.key] = entry.name.includes("Originalidad") ? 4 : 2;
    }
    const overall = computeWeightedIndicatorScore(schema, scores);
    assert.ok(overall != null);
    // (4*25 + 2*15 + 2*20) / 60 = 2.83
    assert.equal(overall, 2.83);
  });

  it("devuelve null si falta alguna nota", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const key = subdimensionScoreKey("Novedad", "Grado de Originalidad de la Idea");
    const scores: Record<string, number | null> = { [key]: 3 };
    assert.equal(computeWeightedIndicatorScore(schema, scores), null);
  });

  it("usa peso uniforme si no hay ponderación explícita", () => {
    const schema = [
      {
        dimension: "Novedad",
        name: "A",
        weight: null,
        key: subdimensionScoreKey("Novedad", "A"),
      },
      {
        dimension: "Novedad",
        name: "B",
        weight: null,
        key: subdimensionScoreKey("Novedad", "B"),
      },
    ];
    const scores = {
      [schema[0].key]: 4,
      [schema[1].key]: 2,
    };
    assert.equal(computeWeightedIndicatorScore(schema, scores), 3);
  });
});

describe("formatIndicatorScore", () => {
  it("muestra siempre 2 decimales", () => {
    assert.equal(formatIndicatorScore(2.95), "2.95");
    assert.equal(formatIndicatorScore(3), "3.00");
    assert.equal(formatIndicatorScore(2.83), "2.83");
    assert.equal(formatIndicatorScore(2.7), "2.70");
    assert.equal(formatIndicatorScore(2.6), "2.60");
  });
});

describe("injectAuthoritativeScoresSection", () => {
  it("reemplaza sección LLM con índice ponderado correcto", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const entry of schema) {
      scores[entry.key] = entry.name.includes("Originalidad") ? 4 : 2;
    }
    const overall = computeWeightedIndicatorScore(schema, scores);
    const llmReport = `## Informe

**Notas por subdimensión e índice IGIP**

Grado de Originalidad de la Idea: 4
Estado del arte: 2
Contribución Social, Ambiental o Productivo: 2

**Índice IGIP**: 2.7`;

    const fixed = injectAuthoritativeScoresSection(llmReport, schema, scores, overall);
    assert.ok(!fixed.includes("2.7"));
    assert.match(fixed, /\*\*Índice IGIP\*\*: 2\.83/);
    assert.doesNotMatch(fixed, /Índice IGIP[\s\S]*Índice IGIP/);
    assert.match(fixed, /ponderación 25%/);
  });

  it("reemplaza sección «Notas e índice» del formateo §6", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const entry of schema) scores[entry.key] = 3;
    const overall = computeWeightedIndicatorScore(schema, scores);
    const llmReport = `**Síntesis final**

Texto de síntesis.

**Notas e índice**

Grado de Originalidad de la Idea: 3 (ponderación 0.15)
Estado del arte: 3 (ponderación 0.10)

Índice final ponderado: 2.55 (sobre 5)`;

    const fixed = injectAuthoritativeScoresSection(llmReport, schema, scores, overall);
    assert.doesNotMatch(fixed, /ponderación 0\.15/);
    assert.doesNotMatch(fixed, /2\.55/);
    assert.match(fixed, /\*\*Notas e índice\*\*/);
    assert.match(fixed, /\*\*Índice IGIP\*\*: 3\.00/);
    assert.doesNotMatch(fixed, /Notas e índice[\s\S]*Notas e índice/);
  });

  it("no corta el informe si «Notas e índice» aparece antes del cierre", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const entry of schema) scores[entry.key] = 3;
    const overall = computeWeightedIndicatorScore(schema, scores);
    const llmReport = `## Estado del arte
Análisis parcial sin nota.

**Notas e índice**
borrador incorrecto

## Contribución Social, Ambiental o Productivo
**Nota: 3**`;

    const fixed = injectAuthoritativeScoresSection(llmReport, schema, scores, overall);
    assert.match(fixed, /Contribución Social/);
    assert.match(fixed, /\*\*Índice IGIP\*\*: 3\.00/);
  });

  it("usa indicatorLabel personalizado en la sección de notas", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    const scores: Record<string, number | null> = {};
    for (const entry of schema) scores[entry.key] = 3;
    const overall = 3;
    const report = `**Notas por subdimensión e índice TRL**\n\n**Índice TRL**: 2.5`;
    const fixed = injectAuthoritativeScoresSection(report, schema, scores, overall, "TRL");
    assert.match(fixed, /\*\*Índice TRL\*\*: 3\.00/);
  });
});

describe("shouldRepairFormattedReport", () => {
  const dimensions = [
    {
      name: "Novedad",
      subdimensions: [
        { name: "Grado de Originalidad de la Idea" },
        { name: "Estado del arte" },
      ],
    },
  ];

  it("no repara si la mayoría de subdimensiones están completas", () => {
    const formatted = `## Grado de Originalidad de la Idea
Nota: 3

## Estado del arte
Nota: 2`;

    assert.equal(shouldRepairFormattedReport(formatted, dimensions), false);
  });

  it("no repara si subdimensiones usan encabezados numerados", () => {
    const formatted = `1. Resumen del proyecto
texto

2. Dimensión: Novedad
resumen macro

3. Grado de Originalidad de la Idea
Análisis completo.
Nota: 3

4. Estado del arte
Análisis.
Nota: 2`;

    assert.equal(shouldRepairFormattedReport(formatted, dimensions), false);
  });

  it("repara si ninguna subdimensión tiene nota", () => {
    assert.equal(shouldRepairFormattedReport("## Resumen\nsolo texto", dimensions), true);
  });
});

describe("repairFormattedReportFromRaw", () => {
  it("recupera subdimensiones truncadas desde el análisis crudo", () => {
    const formatted = `## Resumen
texto

## Grado de Originalidad de la Idea
**Análisis**
Completo.
**Nota: 3**

## Estado del arte
**Análisis**
Incompleto y no se`;

    const raw = `### Subdimensión: Grado de Originalidad de la Idea

**Análisis**
Completo.
**Nota: 3**

### Subdimensión: Estado del arte

**Análisis**
Completo estado del arte.
**Nota: 2**

### Subdimensión: Contribución Social, Ambiental o Productivo

**Análisis**
Impacto social.
**Nota: 3**`;

    const repaired = repairFormattedReportFromRaw(formatted, raw, [
      {
        name: "Novedad",
        subdimensions: [
          { name: "Grado de Originalidad de la Idea" },
          { name: "Estado del arte" },
        ],
      },
      {
        name: "Potencial de impacto",
        subdimensions: [{ name: "Contribución Social, Ambiental o Productivo" }],
      },
    ]);

    assert.match(repaired, /Completo estado del arte/);
    assert.match(repaired, /Impacto social/);
    assert.match(repaired, /\*\*Nota: 2\*\*/);
  });

  it("no duplica subdimensiones ya formateadas con encabezados en negrita", () => {
    const formatted = `**Resumen del proyecto**
Resumen breve.

**Dimensión: Novedad**
Síntesis de dimensión.

**Grado de Originalidad de la Idea**
**Análisis**
Análisis formateado corto.
**Justificación**
Justificación formateada.
**Sugerencias de mejora**
1. Mejora A
**Nota**
Nota: 3

**Estado del arte**
**Análisis**
Análisis estado del arte.
**Nota**
Nota: 2

**Síntesis final**
Cierre evaluativo.`;

    const raw = `### Subdimensión: Grado de Originalidad de la Idea

**Análisis**
Análisis crudo muy largo ${"x".repeat(500)}
**Nota: 3**

### Subdimensión: Estado del arte

**Análisis**
Análisis crudo estado ${"y".repeat(500)}
**Nota: 2**`;

    const repaired = repairFormattedReportFromRaw(formatted, raw, [
      {
        name: "Novedad",
        subdimensions: [
          { name: "Grado de Originalidad de la Idea" },
          { name: "Estado del arte" },
        ],
      },
    ]);

    assert.equal((repaired.match(/Grado de Originalidad de la Idea/g) ?? []).length, 1);
    assert.doesNotMatch(repaired, /Análisis crudo muy largo/);
    assert.match(repaired, /Análisis formateado corto/);
  });
});

describe("truncateSummary", () => {
  it("trunca a 300 caracteres", () => {
    const long = "a".repeat(400);
    const result = truncateSummary(long, 300);
    assert.ok(result.length <= 301);
    assert.ok(result.endsWith("…"));
  });
});

describe("buildRubricScoreSchema", () => {
  it("incluye ponderaciones por subdimensión", () => {
    const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
    assert.equal(schema.length, 3);
    assert.equal(schema[0].weight, 25);
    assert.equal(schema[1].weight, 15);
    assert.equal(schema[2].weight, 20);
  });
});
