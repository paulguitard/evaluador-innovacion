import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEvaluateStreamEvent, createEvaluateStreamState, parseEvaluateNdjsonLine } from "@/lib/evaluate-stream";
import type { EvaluateStreamEvent } from "@/lib/evaluate-pipeline";

describe("evaluate-stream draft vs final", () => {
  it("parseEvaluateNdjsonLine reconoce report_draft", () => {
    const event = parseEvaluateNdjsonLine(
      JSON.stringify({ type: "report_draft", content: "## Dimensión: X\n\n### Subdimensión: Y\n\ntexto" })
    );
    assert.ok(event);
    assert.equal(event!.type, "report_draft");
    if (event!.type === "report_draft") {
      assert.match(event.content, /Subdimensión/);
    }
  });

  it("report_draft añade paso de formateo al trace sin confundirse con done", () => {
    let state = createEvaluateStreamState();
    const draft: EvaluateStreamEvent = {
      type: "report_draft",
      content: "borrador",
    };
    state = applyEvaluateStreamEvent(state, draft, false);
    assert.ok(state.trace.some((t) => /Borrador de evaluación listo/i.test(t.title)));
  });
});
