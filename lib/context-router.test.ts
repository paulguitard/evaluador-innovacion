import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultChatAgentConfig } from "@/lib/chat-agent-config";
import { bulkEvaluationPlan } from "@/lib/context-plan";
import {
  applyHardRules,
  asksScoreImprovement,
  classifyQueryIntents,
  type RouterInput,
} from "@/lib/context-router-rules";

const agentConfig = defaultChatAgentConfig();

function baseInput(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    message: "",
    hasProjectData: false,
    hasBulkEvaluationData: false,
    hasRubric: true,
    hasKnowledge: true,
    ...overrides,
  };
}

describe("asksScoreImprovement", () => {
  it("detecta subir nota de 2 a 3", () => {
    assert.equal(
      asksScoreImprovement(
        "¿Qué podría mejorar CONenergía para subir Transferencia Tecnológica de 2 a 3?"
      ),
      true
    );
  });
});

describe("classifyQueryIntents", () => {
  it("knowledge-only no marca proyectos bulk", () => {
    const intents = classifyQueryIntents(
      "¿Qué dice el manual de Oslo sobre innovación?",
      baseInput({ hasBulkEvaluationData: true })
    );
    assert.equal(intents.wantsKnowledge, true);
    assert.equal(intents.wantsBulkProjects, false);
  });

  it("comparar proyectos marca bulk", () => {
    const intents = classifyQueryIntents(
      "Compara los tres proyectos evaluados en transferencia tecnológica",
      baseInput({ hasBulkEvaluationData: true })
    );
    assert.equal(intents.wantsBulkProjects, true);
  });
});

describe("applyHardRules bulk evaluation", () => {
  it("knowledge-only con bulk data no fuerza rúbrica ni tools bulk", () => {
    const message = "¿Qué dice el manual de Oslo sobre innovación disruptiva?";
    const plan = applyHardRules(
      bulkEvaluationPlan(message),
      message,
      baseInput({ hasBulkEvaluationData: true }),
      agentConfig
    );
    assert.ok(plan.sources.includes("knowledge_rag"));
    assert.ok(!plan.sources.includes("rubric"));
    assert.ok(!plan.toolsHint.includes("list_bulk_projects"));
    assert.ok(!plan.toolsHint.includes("get_project_elements"));
  });

  it("mejora de nota fuerza rúbrica y tools bulk", () => {
    const message =
      "¿Qué podría mejorar CONenergía para subir Transferencia Tecnológica de 2 a 3?";
    const plan = applyHardRules(
      bulkEvaluationPlan(message),
      message,
      baseInput({ hasBulkEvaluationData: true }),
      agentConfig
    );
    assert.ok(plan.sources.includes("rubric"));
    assert.ok(plan.toolsHint.includes("get_rubric"));
    assert.ok(plan.toolsHint.includes("list_bulk_projects"));
    assert.ok(!plan.toolsHint.includes("get_project_elements"));
    assert.equal(plan.useToolLoop, true);
  });

  it("comparar proyectos activa tools bulk sin tools de sesión", () => {
    const message = "Compara ClinicApp y CONenergía en transferencia tecnológica";
    const plan = applyHardRules(
      bulkEvaluationPlan(message),
      message,
      baseInput({ hasBulkEvaluationData: true }),
      agentConfig
    );
    assert.ok(plan.toolsHint.includes("search_bulk_projects"));
    assert.ok(!plan.toolsHint.includes("get_project_elements"));
    assert.ok(!plan.toolsHint.includes("search_project"));
  });
});
