import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectAssembledReport,
  countSubdimensionTitleOccurrences,
  formatSubdimensionBlock,
  isSynthesisSection,
} from "@/lib/assemble-formatted-report";
import { defaultEvaluationConfig } from "@/lib/evaluation-config";
import {
  defaultReportFormatPonderaciones,
  enrichReportFormatWithLegacySections,
  expandReportSections,
} from "@/lib/report-format-config";
import { defaultRubricConfigPonderaciones } from "@/lib/rubric-config";

describe("assemble-formatted-report", () => {
  const rubric = defaultRubricConfigPonderaciones();
  const evaluation = defaultEvaluationConfig();
  const sub = rubric.dimensions[0].subdimensions[0];

  function mockSectionBody(prefix: string, minChars: number): string {
    let body = prefix;
    while (body.length < minChars) {
      body += " El contenido desarrolla el análisis con detalle evaluativo suficiente.";
    }
    return body.endsWith(".") ? body : `${body}.`;
  }

  const rawEvaluation = `## Dimensión: ${rubric.dimensions[0].name}

### Subdimensión: ${sub.name}

**Análisis**
Texto de análisis detallado con referencia al Knowledge.

Nota: 3

**Justificación**
Justificación fundamentada en Oslo Manual.

**Posibles mejoras**
1. Mejora concreta A.
2. Mejora concreta B.`;

  it("isSynthesisSection detecta síntesis custom", () => {
    assert.equal(
      isSynthesisSection({
        id: "s1",
        title: "Síntesis final",
        description: "",
        minChars: 100,
        maxChars: 300,
        kind: "custom",
      }),
      true
    );
    assert.equal(
      isSynthesisSection({
        id: "s2",
        title: "Resumen del proyecto",
        description: "",
        minChars: 100,
        maxChars: 500,
        kind: "custom",
      }),
      false
    );
  });

  it("formatSubdimensionBlock conserva cuerpo verbatim de §5", () => {
    const sections = expandReportSections(rubric, defaultReportFormatPonderaciones(rubric));
    const section = sections.find(
      (s) => s.kind === "subdimension_eval" && s.subdimensionId === sub.id
    );
    assert.ok(section);
    const block = formatSubdimensionBlock(section!, rubric, rawEvaluation);
    assert.match(block, new RegExp(`## ${sub.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(block, /Texto de análisis detallado con referencia al Knowledge/);
    assert.match(block, /Nota: 3/);
    assert.match(block, /Posibles mejoras/);
    assert.doesNotMatch(block, /### Subdimensión:/);
  });

  it("collectAssembledReport no trunca resúmenes de dimensión", async () => {
    const fmt = enrichReportFormatWithLegacySections(
      defaultReportFormatPonderaciones(rubric),
      rubric,
      ""
    );
    const report = await collectAssembledReport({
      rubric,
      reportFormat: fmt,
      rawEvaluation,
      projectElementsTable: [],
      evaluation,
      streamSection: async function* (messages) {
        const system = messages.find((m) => m.role === "system")?.content ?? "";
        if (/resumen macro de la dimensión/i.test(system)) {
          yield `## Dimensión: Novedad\n\n${mockSectionBody("Resumen macro completo de la dimensión Novedad", 410)}`;
        } else if (/síntesis narrativa del proyecto/i.test(system)) {
          yield `## Resumen del proyecto\n\n${mockSectionBody("Resumen completo del proyecto", 460)}`;
        }
      },
    });
    assert.match(report, /Resumen macro completo de la dimensión Novedad/);
    assert.doesNotMatch(report, /…/);
    assert.doesNotMatch(report, /\.\.\./);
  });

  it("collectAssembledReport incluye resumen con config enriquecida", async () => {
    const fmt = enrichReportFormatWithLegacySections(
      defaultReportFormatPonderaciones(rubric),
      rubric,
      "1. Resumen del proyecto (500 caracteres)"
    );

    const mockStream = async function* (
      messages: { role: string; content: string }[]
    ): AsyncGenerator<string> {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      if (/síntesis narrativa del proyecto/i.test(system)) {
        yield `## Resumen del proyecto\n\n${mockSectionBody("Resumen mock del proyecto evaluado", 460)}`;
      } else if (/resumen macro de la dimensión/i.test(system)) {
        yield `## Dimensión: Novedad\n\n${mockSectionBody("Resumen macro mock de la dimensión", 410)}`;
      }
    };

    const report = await collectAssembledReport({
      rubric,
      reportFormat: fmt,
      rawEvaluation,
      projectElementsTable: [{ element: "Objetivo", content: "Crear reservorio apícola." }],
      evaluation,
      streamSection: (messages, _maxTokens) => mockStream(messages),
    });

    assert.match(report, /Resumen mock del proyecto/);
    assert.match(report, /Resumen macro mock de la dimensión/);
  });

  it("collectAssembledReport no duplica subdimensiones y omite síntesis", async () => {
    const fmt = {
      ...defaultReportFormatPonderaciones(rubric),
      preamble: [
        {
          id: "p1",
          title: "Resumen del proyecto",
          description: "Síntesis breve",
          minChars: 100,
          maxChars: 200,
        },
      ],
      beforeScores: [
        {
          id: "b1",
          title: "Síntesis final",
          description: "Conclusión global",
          minChars: 100,
          maxChars: 300,
        },
      ],
    };

    const mockStream = async function* (
      messages: { role: string; content: string }[]
    ): AsyncGenerator<string> {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      if (/síntesis narrativa del proyecto/i.test(system)) {
        yield `## Resumen del proyecto\n\n${mockSectionBody("Resumen mock del proyecto evaluado", 110)}`;
      } else if (/resumen macro de la dimensión/i.test(system)) {
        yield `## Dimensión: Novedad\n\n${mockSectionBody("Resumen macro mock de la dimensión", 410)}`;
      }
    };

    const report = await collectAssembledReport({
      rubric,
      reportFormat: fmt,
      rawEvaluation,
      projectElementsTable: [{ element: "Objetivo", content: "Crear reservorio apícola." }],
      evaluation,
      streamSection: (messages, _maxTokens) => mockStream(messages),
    });

    assert.match(report, /Resumen mock del proyecto/);
    assert.match(report, /Resumen macro mock de la dimensión/);
    assert.match(report, /Texto de análisis detallado con referencia al Knowledge/);
    assert.doesNotMatch(report, /Síntesis final/i);

    for (const dim of rubric.dimensions) {
      for (const s of dim.subdimensions) {
        assert.equal(countSubdimensionTitleOccurrences(report, s.name), 1);
      }
    }

    const sections = expandReportSections(rubric, fmt);
    const resumenIdx = report.indexOf("Resumen del proyecto");
    const dimIdx = report.indexOf("Dimensión: Novedad");
    const subIdx = report.indexOf(sub.name);
    assert.ok(resumenIdx >= 0 && dimIdx > resumenIdx && subIdx > dimIdx);
  });

  it("countSubdimensionTitleOccurrences detecta encabezados numerados", () => {
    const report = `## Resumen

3. Grado de Originalidad de la Idea

Análisis texto.`;
    assert.equal(
      countSubdimensionTitleOccurrences(report, "Grado de Originalidad de la Idea"),
      1
    );
  });
});
