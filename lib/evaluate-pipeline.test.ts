import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EvaluateLlmSemaphore,
  getGlobalLlmSemaphore,
  GLOBAL_MAX_CONCURRENT_LLM,
} from "@/lib/evaluate-concurrency";

describe("evaluate-concurrency", () => {
  it("limits concurrent runs to max", async () => {
    const sem = new EvaluateLlmSemaphore(2);
    let active = 0;
    let peak = 0;

    const task = () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
      });

    await Promise.all([task(), task(), task(), task()]);
    assert.equal(peak, 2);
  });

  it("getGlobalLlmSemaphore devuelve singleton con tope GLOBAL_MAX_CONCURRENT_LLM", () => {
    const a = getGlobalLlmSemaphore();
    const b = getGlobalLlmSemaphore();
    assert.equal(a, b);
    assert.equal(GLOBAL_MAX_CONCURRENT_LLM, 8);
  });
});
