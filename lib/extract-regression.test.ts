import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripIndexedCellMetadata } from "@/lib/extract-content-clean";
import { extractFormRowFromExcel } from "@/lib/form-row-extract";
import { allowFallbackOverwrite, isCanonicalExtraction } from "@/lib/extract-source-policy";
import { bitacoraAguaConectaFixture } from "@/lib/extract-regression.fixture";

describe("extract-source-policy", () => {
  it("form_row es extracción canónica", () => {
    assert.equal(isCanonicalExtraction("form_row"), true);
    assert.equal(allowFallbackOverwrite("form_row", true), false);
    assert.equal(allowFallbackOverwrite("keyword_scan", true), true);
  });
});

describe("form-row-extract bitácora", () => {
  const fixture = [bitacoraAguaConectaFixture()];

  it("continuidad: respuesta completa sin pregunta ni fila 21", () => {
    const r = extractFormRowFromExcel(fixture, { title: "Continuidad de fases anteriores" });
    assert.ok(r?.content);
    assert.match(r!.content, /^S[ií],?\s+este\s+proyecto/i);
    assert.doesNotMatch(r!.content, /¿El proyecto es continuidad/i);
    assert.doesNotMatch(r!.content, /fila\s+21/i);
    assert.doesNotMatch(r!.content, /consiste la soluci[oó]n propuesta/i);
  });

  it("necesidad: párrafo de la fila 19", () => {
    const r = extractFormRowFromExcel(fixture, { title: "Necesidad, problema u oportunidad" });
    assert.ok(r?.content);
    assert.match(r!.content, /Comunidad de Regantes El Zaino/i);
    assert.doesNotMatch(r!.content, /que aborda la iniciativa\.\s*$/i);
  });

  it("pertinencia local: solo bloque local", () => {
    const r = extractFormRowFromExcel(fixture, { title: "Pertinencia local" });
    assert.ok(r?.content);
    assert.match(r!.content, /iniciativa entrega informaci[oó]n/i);
    assert.doesNotMatch(r!.content, /y Disciplinar/i);
    assert.doesNotMatch(r!.content, /Permite a los estudiantes/i);
  });
});

describe("stripIndexedCellMetadata", () => {
  it("elimina marcadores de chunk RAG", () => {
    const raw = "(fila 21, col 5): La solución propuesta consiste en una página web.";
    assert.equal(stripIndexedCellMetadata(raw), "La solución propuesta consiste en una página web.");
  });
});
