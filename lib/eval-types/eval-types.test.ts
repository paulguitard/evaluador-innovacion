import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPromptTemplate,
  fixedKeyFor,
  isIgip,
  isImet,
  rubricTypeFor,
} from "@/lib/eval-types";

describe("eval-types", () => {
  it("clasifica IGIP e IMET", () => {
    assert.equal(isIgip("IGIP"), true);
    assert.equal(isImet("IMET"), true);
    assert.equal(isImet("TRL"), false);
    assert.equal(fixedKeyFor("imet-v2"), "IMET");
    assert.equal(fixedKeyFor("algo"), "IGIP");
  });

  it("rubricTypeFor fija modalidades", () => {
    assert.equal(rubricTypeFor("IGIP"), "ponderaciones");
    assert.equal(rubricTypeFor("IMET"), "niveles");
  });

  it("applyPromptTemplate sustituye placeholders", () => {
    const out = applyPromptTemplate("Hola {{name}}", { name: "mundo" });
    assert.equal(out, "Hola mundo");
  });
});
