import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSectionFormatSystemPrompt,
  estimateSectionMaxTokens,
  isLightTruncationOnly,
  isSectionTextComplete,
  isSectionTextTruncated,
  resolveSectionSource,
  sectionAcceptsLightTruncation,
} from "@/lib/format-report-sections";
import {
  defaultReportFormatPonderaciones,
  expandReportSections,
  subdimensionEvalId,
} from "@/lib/report-format-config";
import { defaultRubricConfigPonderaciones } from "@/lib/rubric-config";

describe("format-report-sections", () => {
  const rubric = defaultRubricConfigPonderaciones();
  const fmt = defaultReportFormatPonderaciones(rubric);
  fmt.subdimensionEvalLimits = { minChars: 1400, maxChars: 1500 };

  it("buildSectionFormatSystemPrompt incluye min y max de la sección", () => {
    const sections = expandReportSections(rubric, fmt);
    const sub = sections.find((s) => s.kind === "subdimension_eval");
    assert.ok(sub);
    const prompt = buildSectionFormatSystemPrompt(sub!, rubric);
    assert.match(prompt, /1400/);
    assert.match(prompt, /1500/);
    assert.match(prompt, /PROHIBIDO resumir por debajo del mínimo/i);
    assert.match(prompt, /Preserva la línea exacta «Nota: N»/i);
  });

  it("estimateSectionMaxTokens escala con maxChars", () => {
    const sections = expandReportSections(rubric, fmt);
    const sub = sections.find((s) => s.kind === "subdimension_eval");
    assert.ok(sub);
    const tokens = estimateSectionMaxTokens(sub!);
    assert.ok(tokens >= 1024);
    assert.ok(tokens <= 8192);
    assert.ok(tokens > estimateSectionMaxTokens({ ...sub!, maxChars: 400 }));
  });

  it("resolveSectionSource extrae bloque de subdimensión del raw", () => {
    const sub = rubric.dimensions[0].subdimensions[0];
    const raw = `## Dimensión: ${rubric.dimensions[0].name}

### Subdimensión: ${sub.name}

**Análisis**
Texto de análisis detallado.

Nota: 3

**Justificación**
Más texto.`;

    const sections = expandReportSections(rubric, fmt);
    const section = sections.find(
      (s) => s.kind === "subdimension_eval" && s.subdimensionId === sub.id
    );
    assert.ok(section);
    const source = resolveSectionSource(section!, rubric, raw, []);
    assert.match(source, /Texto de análisis detallado/);
    assert.match(source, /Nota: 3/);
    assert.doesNotMatch(source, /### Subdimensión:/);
  });

  it("resolveSectionSource usa projectElements para resumen del proyecto", () => {
    const withPreamble = {
      ...fmt,
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
    const sections = expandReportSections(rubric, withPreamble);
    const resumen = sections.find((s) => s.kind === "custom");
    assert.ok(resumen);
    const source = resolveSectionSource(resumen!, rubric, "raw", [
      { element: "Objetivo", content: "Crear un reservorio apícola." },
    ]);
    assert.match(source, /Objetivo/);
    assert.match(source, /reservorio apícola/);
    assert.doesNotMatch(source, /^\*\*Objetivo\*\*/m);
  });

  it("buildSectionFormatSystemPrompt resumen proyecto prohíbe copiar campos", () => {
    const section = {
      id: "p1",
      title: "Resumen del proyecto",
      description: "",
      minChars: 900,
      maxChars: 1000,
      kind: "custom" as const,
    };
    const prompt = buildSectionFormatSystemPrompt(section, rubric);
    assert.match(prompt, /NO copies ni listes/i);
    assert.match(prompt, /síntesis narrativa/i);
  });

  it("isSectionTextTruncated detecta texto cortado", () => {
    assert.equal(isSectionTextTruncated("Texto que termina bien."), false);
    assert.equal(isSectionTextTruncated("Texto que termina mal en ofreciendo"), true);
    assert.equal(isSectionTextTruncated("No"), true);
    assert.equal(isSectionTextTruncated("Párrafo completo.\n\n**Nota: 3**"), false);
    assert.equal(isSectionTextTruncated("Lista con cierre (ver punto 2)."), false);
    assert.equal(
      isSectionTextTruncated("Cierre limpio en párrafo final. ---"),
      false,
      "no debe marcar como truncado si termina con separador markdown ---"
    );
    assert.equal(
      isSectionTextTruncated("Otro párrafo cerrado con punto.\n\n---"),
      false,
      "separador markdown en línea propia también debe ignorarse"
    );
    assert.equal(
      isSectionTextTruncated("Texto colgado sin punto ---"),
      true,
      "sin punto antes del separador sigue siendo truncado"
    );
  });

  it("isSectionTextComplete exige longitud mínima y cierre", () => {
    assert.equal(isSectionTextComplete("Texto que termina bien.", 10), true);
    assert.equal(isSectionTextComplete("Texto que termina mal en ofreciendo", 10), false);
    assert.equal(isSectionTextComplete("No", 5), false);
  });

  it("expandReportSections mantiene orden dimensión → subdimensiones", () => {
    const sections = expandReportSections(rubric, fmt);
    const kinds = sections.map((s) => s.kind);
    const firstSubIdx = kinds.indexOf("subdimension_eval");
    const firstDimIdx = kinds.indexOf("dimension_overview");
    assert.ok(firstDimIdx >= 0);
    assert.ok(firstSubIdx > firstDimIdx);
    const subIds = sections
      .filter((s) => s.kind === "subdimension_eval")
      .map((s) => s.id);
    assert.ok(subIds.every((id) => id.startsWith("sub_eval_")));
    assert.equal(subIds[0], subdimensionEvalId(rubric.dimensions[0].subdimensions[0].id));
  });

  it("dimension overview usa maxChars como objetivo suave", () => {
    const sections = expandReportSections(rubric, fmt);
    const overview = sections.find((s) => s.kind === "dimension_overview");
    assert.ok(overview);
    const prompt = buildSectionFormatSystemPrompt(overview!, rubric);
    assert.match(prompt, /Mínimo obligatorio/i);
    assert.match(prompt, /Objetivo aproximado/i);
    assert.match(prompt, /350|700/);
  });

  it("isLightTruncationOnly detecta fragmento corto final con minChars cumplido", () => {
    const section = {
      id: "dim_overview_x",
      title: "Dimensión: Novedad",
      description: "test",
      minChars: 350,
      maxChars: 700,
      kind: "dimension_overview" as const,
    };
    const padding = "a".repeat(360);
    const text = `## ${section.title}\n\n${padding}\n\nfragmento`;
    assert.equal(sectionAcceptsLightTruncation(section), true);
    assert.equal(isLightTruncationOnly(section, text), true);
  });
});
