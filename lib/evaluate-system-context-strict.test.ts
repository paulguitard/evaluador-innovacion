import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStrictEvaluationSystemMessage,
  EvaluateSystemContextError,
  validateEvaluateSystemContext,
  validateProjectElementsForEvaluation,
} from "@/lib/evaluate-system-context-strict";

const SAMPLE_CONTEXT = `## Configuración actual de este tipo de evaluación

**Metodología de evaluación:**
Programada en la aplicación.

---

## Enfoque de esta evaluación parcial

Evalúa ÚNICAMENTE la subdimensión **Originalidad** (dimensión **Idea**).

### Criterios de esta subdimensión

Criterios detallados de la subdimensión con suficiente longitud para validar.

---

## Documentos del proyecto a evaluar (elementos identificados)

**Objetivo general:**
Contenido del objetivo extraído del proyecto.

---

## Documentación de referencia (Knowledge)

REGLA: Fundamenta tu respuesta.

### Documento: Manual.pdf

Texto del fragmento recuperado del knowledge.

---

## Rúbrica y criterios de evaluación

Dimensión Idea con subdimensiones y notas 1 a 4 descritas en detalle.`;

describe("evaluate-system-context-strict", () => {
  it("acepta contexto completo sin truncación", () => {
    assert.doesNotThrow(() => validateEvaluateSystemContext(SAMPLE_CONTEXT));
    const msg = buildStrictEvaluationSystemMessage(SAMPLE_CONTEXT);
    assert.ok(msg.includes("español"));
    assert.ok(msg.includes("Metodología de evaluación"));
  });

  it("rechaza contexto vacío", () => {
    assert.throws(
      () => validateEvaluateSystemContext(""),
      (err: unknown) => err instanceof EvaluateSystemContextError
    );
  });

  it("rechaza truncación", () => {
    assert.throws(
      () =>
        validateEvaluateSystemContext(
          `${SAMPLE_CONTEXT}\n\n[Contexto truncado por límite de longitud.]`
        ),
      (err: unknown) =>
        err instanceof EvaluateSystemContextError &&
        err.missingSections.includes("truncación")
    );
  });

  it("rechaza knowledge sin fragmentos", () => {
    const withoutDocs = SAMPLE_CONTEXT.replace(
      "### Documento: Manual.pdf\n\nTexto del fragmento recuperado del knowledge.",
      ""
    );
    assert.throws(() => validateEvaluateSystemContext(withoutDocs));
  });

  it("rechaza proyecto sin elementos", () => {
    assert.throws(
      () => validateProjectElementsForEvaluation([]),
      (err: unknown) => err instanceof EvaluateSystemContextError
    );
  });

  it("buildStrictEvaluationSystemMessage no usa fallback", () => {
    assert.throws(() => buildStrictEvaluationSystemMessage("   "));
  });
});
