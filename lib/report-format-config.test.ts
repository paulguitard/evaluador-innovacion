import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFormatSystemPrompt,
  buildFormatUserPrompt,
  defaultReportFormatPonderaciones,
  defaultReportFormatNiveles,
  enrichReportFormatWithLegacySections,
  expandReportSections,
  estimateFormatReportMaxTokens,
  findMissingReportSectionTitles,
  getSynthesisMaxChars,
  mergeReportFormatConfig,
  parseReportFormatFromLegacyText,
  syncReportFormatWithRubric,
} from "@/lib/report-format-config";
import { defaultRubricConfigPonderaciones, parseRubricFromLegacyText } from "@/lib/rubric-config";

describe("report-format-config", () => {
  it("enrichReportFormatWithLegacySections añade resumen y síntesis si faltan", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const base = defaultReportFormatPonderaciones(rubric);
    const legacy =
      "1. Resumen del proyecto (1000 caracteres)\n5. Síntesis de los análisis (800 caracteres)";
    const enriched = enrichReportFormatWithLegacySections(base, rubric, legacy);
    assert.equal(enriched.preamble.length, 1);
    assert.match(enriched.preamble[0].title, /Resumen del proyecto/i);
    assert.equal(enriched.preamble[0].maxChars, 1000);
    assert.equal(enriched.beforeScores.length, 1);
    assert.match(enriched.beforeScores[0].title, /Síntesis/i);
    assert.equal(enriched.beforeScores[0].maxChars, 800);
  });

  it("plantilla ponderaciones deriva estructura de la rúbrica sin secciones predefinidas", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = defaultReportFormatPonderaciones(rubric);
    assert.equal(fmt.preamble.length, 0);
    assert.equal(fmt.beforeScores.length, 0);
    assert.equal("scoresSummary" in fmt, false);
    const expanded = expandReportSections(rubric, fmt);
    assert.ok(expanded.some((s) => s.kind === "subdimension_eval"));
    assert.equal(expanded.some((s) => s.kind === "scores_summary" as never), false);
    assert.equal(expanded.some((s) => s.kind === "custom"), false);
  });

  it("plantilla niveles incluye assigned_level obligatorio", () => {
    const fmt = defaultReportFormatNiveles();
    const expanded = expandReportSections(
      { type: "niveles", levels: [{ id: "l1", level: 1, title: "N1", description: "" }] },
      fmt
    );
    assert.ok(expanded.some((s) => s.kind === "assigned_level"));
  });

  it("síntesis solo si el usuario añade sección custom", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = defaultReportFormatPonderaciones(rubric);
    assert.equal(getSynthesisMaxChars(fmt, rubric), null);
    const withSyn = syncReportFormatWithRubric(
      {
        ...fmt,
        beforeScores: [
          {
            id: "x",
            title: "Síntesis final",
            description: "Cierre",
            minChars: 200,
            maxChars: 300,
          },
        ],
      },
      rubric
    );
    assert.equal(getSynthesisMaxChars(withSyn, rubric), 300);
  });

  it("buildFormatSystemPrompt omite notas del LLM y avisa inserción automática", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = defaultReportFormatPonderaciones(rubric);
    const prompt = buildFormatSystemPrompt(fmt, rubric);
    assert.doesNotMatch(prompt, /\d+\.\s+\*\*Notas e índice\*\*/);
    assert.match(prompt, /se insertará automáticamente/i);
    assert.match(prompt, /siguiente mensaje/i);
    assert.match(prompt, /subdimensión/i);
    assert.match(prompt, /sintetiza/i);
    assert.match(prompt, /TODAS las secciones/i);
  });

  it("buildFormatUserPrompt incluye el borrador", () => {
    const user = buildFormatUserPrompt("texto borrador eval");
    assert.match(user, /texto borrador eval/);
    assert.match(user, /BORRADOR DE EVALUACIÓN/i);
  });

  it("buildFormatUserPrompt incluye elementos del proyecto y orden de secciones", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = {
      ...defaultReportFormatPonderaciones(rubric),
      preamble: [
        {
          id: "p1",
          title: "Resumen del proyecto",
          description: "Síntesis breve",
          minChars: 900,
          maxChars: 1000,
        },
      ],
    };
    const user = buildFormatUserPrompt("borrador subdims", {
      projectElementsTable: [{ element: "Objetivo", content: "Crear reservorio apícola." }],
      reportFormat: fmt,
      rubric,
    });
    assert.match(user, /ELEMENTOS DEL PROYECTO/);
    assert.match(user, /reservorio apícola/i);
    assert.match(user, /ORDEN OBLIGATORIO/);
    assert.match(user, /Resumen del proyecto/);
  });

  it("findMissingReportSectionTitles detecta secciones ausentes", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = {
      ...defaultReportFormatPonderaciones(rubric),
      preamble: [
        {
          id: "p1",
          title: "Resumen del proyecto",
          description: "",
          minChars: 100,
          maxChars: 200,
        },
      ],
    };
    const missing = findMissingReportSectionTitles("## Dimensión: Novedad\n\nTexto", fmt, rubric);
    assert.ok(missing.includes("Resumen del proyecto"));
  });

  it("estimateFormatReportMaxTokens no fuerza piso 8192", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = {
      ...defaultReportFormatPonderaciones(rubric),
      subdimensionEvalLimits: { minChars: 400, maxChars: 500 },
      dimensionOverviewLimits: { minChars: 200, maxChars: 300 },
    };
    const tokens = estimateFormatReportMaxTokens(fmt, rubric);
    assert.ok(tokens < 8192);
    assert.ok(tokens >= 2048);
  });

  it("parse legacy migra resumen y síntesis a secciones custom", () => {
    const rubric = parseRubricFromLegacyText(`----------Dimensión Novedad:-------------
Subdimensión "Test"
- Ponderación (100%)
- Nota 1: A`);
    assert.ok(rubric);
    const legacy = "Resumen del proyecto (1000 caracteres)\nSíntesis final (300 caracteres)";
    const fmt = parseReportFormatFromLegacyText(legacy, rubric);
    assert.ok(fmt);
    assert.equal(fmt!.preamble.length, 1);
    assert.equal(fmt!.beforeScores.length, 1);
    const expanded = expandReportSections(rubric!, fmt!);
    assert.ok(expanded.some((s) => s.kind === "subdimension_eval"));
  });

  it("subdimensiones comparten instrucciones globales", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = defaultReportFormatPonderaciones(rubric);
    assert.match(fmt.subdimensionEvalInstructions, /Justificación/i);
    assert.match(fmt.subdimensionEvalInstructions, /Nota/i);
    const expanded = expandReportSections(rubric, fmt);
    const subs = expanded.filter((s) => s.kind === "subdimension_eval");
    assert.ok(subs.length > 1);
    assert.equal(subs[0].description, subs[1].description);
  });

  it("sync conserva límites globales", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const fmt = defaultReportFormatPonderaciones(rubric);
    fmt.dimensionOverviewLimits = { minChars: 100, maxChars: 200 };
    const synced = syncReportFormatWithRubric(fmt, rubric);
    assert.equal(synced.dimensionOverviewLimits.maxChars, 200);
  });
});
