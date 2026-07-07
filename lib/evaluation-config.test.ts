import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEvaluationConfigToReportFormat,
  buildEvaluationConfigFromLegacy,
  defaultEvaluationConfig,
  isEvaluationConfigEmpty,
  mergeEvaluationConfig,
} from "@/lib/evaluation-config";
import { defaultPipelineConfig } from "@/lib/evaluation-type-settings";
import { defaultReportFormatPonderaciones } from "@/lib/report-format-config";
import { defaultRubricConfigPonderaciones } from "@/lib/rubric-config";

describe("evaluation-config", () => {
  it("defaultEvaluationConfig has expected fields", () => {
    const cfg = defaultEvaluationConfig("TRL");
    assert.equal(cfg.indicatorLabel, "TRL");
    assert.equal(cfg.knowledgeReferenceLabel, "Manual de referencia");
    assert.equal(cfg.projectElementsInRagQuery, 8);
    assert.equal(cfg.parallelDimensions, true);
    assert.equal(cfg.phaseInstructions.dimensionOverview, "");
  });

  it("mergeEvaluationConfig prefers evaluation_config over legacy", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const report = defaultReportFormatPonderaciones(rubric);
    const pipeline = defaultPipelineConfig("IGIP");
    const merged = mergeEvaluationConfig(
      {
        evaluation_config: { indicatorLabel: "Custom", knowledgeReferenceLabel: "Manual OSLO" },
        pipeline_config: pipeline,
        report_format_config: report,
      },
      "IGIP"
    );
    assert.equal(merged.indicatorLabel, "Custom");
    assert.equal(merged.knowledgeReferenceLabel, "Manual OSLO");
    assert.equal(merged.parallelSubdimensions, pipeline.parallelSubdimensions);
    assert.equal(merged.parallelDimensions, pipeline.parallelDimensions);
  });

  it("buildEvaluationConfigFromLegacy reads pipeline and report_format", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const report = {
      ...defaultReportFormatPonderaciones(rubric),
      dimensionOverviewInstructions: "Instrucción legacy dim",
      subdimensionEvalInstructions: "Instrucción legacy sub",
      dimensionOverviewLimits: { minChars: 100, maxChars: 200 },
    };
    const built = buildEvaluationConfigFromLegacy(
      {
        pipeline_config: { indicatorLabel: "IGIP", parallelSubdimensions: false },
        report_format_config: report,
      },
      "IGIP"
    );
    assert.equal(built.indicatorLabel, "IGIP");
    assert.equal(built.parallelSubdimensions, false);
    assert.equal(built.phaseInstructions.subdimensionEval, "Instrucción legacy sub");
    assert.equal(built.phaseInstructions.dimensionOverview, "");
  });

  it("applyEvaluationConfigToReportFormat no modifica report_format", () => {
    const rubric = defaultRubricConfigPonderaciones();
    const report = defaultReportFormatPonderaciones(rubric);
    const evalCfg = defaultEvaluationConfig();
    evalCfg.outputLimits.subdimensionEval = { minChars: 900, maxChars: 1100 };
    const synced = applyEvaluationConfigToReportFormat(report, evalCfg);
    assert.deepEqual(synced.subdimensionEvalLimits, report.subdimensionEvalLimits);
    assert.equal(synced.subdimensionEvalInstructions, report.subdimensionEvalInstructions);
  });

  it("isEvaluationConfigEmpty", () => {
    assert.equal(isEvaluationConfigEmpty(null), true);
    assert.equal(isEvaluationConfigEmpty({}), true);
    assert.equal(isEvaluationConfigEmpty({ indicatorLabel: "X" }), false);
  });
});
