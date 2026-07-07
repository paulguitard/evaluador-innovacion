import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidEvalTypeDeletePassword } from "@/lib/eval-type-delete-password";

describe("isValidEvalTypeDeletePassword", () => {
  it("acepta la contraseña configurada", () => {
    assert.equal(isValidEvalTypeDeletePassword("bitacora"), true);
  });

  it("rechaza contraseña incorrecta o vacía", () => {
    assert.equal(isValidEvalTypeDeletePassword("wrong"), false);
    assert.equal(isValidEvalTypeDeletePassword(""), false);
    assert.equal(isValidEvalTypeDeletePassword(undefined), false);
    assert.equal(isValidEvalTypeDeletePassword(null), false);
  });
});
