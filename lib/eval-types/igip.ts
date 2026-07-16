import { defaultEvaluationConfigForType } from "@/lib/evaluation-config";
import {
  defaultExtractConfig,
  defaultEvaluationTypeSettings,
  type ExtractConfig,
  type EvaluationTypeSettings,
} from "@/lib/evaluation-type-settings";
import { defaultReportFormatPonderaciones } from "@/lib/report-format-config";
import { defaultRubricConfigPonderaciones } from "@/lib/rubric-config";
import { buildExtractTypeSpecificDefaults } from "./extract-config-defaults";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
} from "./prompt-defaults";

export function igipRubricDefault() {
  return defaultRubricConfigPonderaciones();
}

export function igipExtractDefault(): ExtractConfig {
  const base = defaultExtractConfig();
  return {
    ...base,
    ...buildExtractTypeSpecificDefaults("IGIP"),
    prompts: { system: DEFAULT_EXTRACT_SYSTEM_PROMPT },
  };
}

export function igipEvaluationDefaults() {
  return defaultEvaluationConfigForType("IGIP");
}

export function igipReportFormatDefault() {
  return defaultReportFormatPonderaciones(igipRubricDefault());
}

export function igipTypeSettings(): EvaluationTypeSettings {
  const settings = defaultEvaluationTypeSettings("IGIP");
  return {
    ...settings,
    extract: igipExtractDefault(),
    pipeline: {
      ...settings.pipeline,
      indicatorLabel: "IGIP",
    },
  };
}
