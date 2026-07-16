import { defaultEvaluationConfigForType } from "@/lib/evaluation-config";
import {
  defaultExtractConfig,
  defaultEvaluationTypeSettings,
  type ExtractConfig,
  type EvaluationTypeSettings,
} from "@/lib/evaluation-type-settings";
import { defaultReportFormatNiveles } from "@/lib/report-format-config";
import { defaultRubricConfigNiveles } from "@/lib/rubric-config";
import { buildExtractTypeSpecificDefaults } from "./extract-config-defaults";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET,
} from "./prompt-defaults";

export function imetRubricDefault() {
  return defaultRubricConfigNiveles();
}

export function imetExtractDefault(): ExtractConfig {
  const base = defaultExtractConfig();
  return {
    ...base,
    ...buildExtractTypeSpecificDefaults("IMET"),
    prompts: { system: DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET },
  };
}

export function imetEvaluationDefaults() {
  return defaultEvaluationConfigForType("IMET");
}

export function imetReportFormatDefault() {
  return defaultReportFormatNiveles();
}

export function imetTypeSettings(): EvaluationTypeSettings {
  const settings = defaultEvaluationTypeSettings("IMET");
  return {
    ...settings,
    extract: imetExtractDefault(),
    pipeline: {
      ...settings.pipeline,
      indicatorLabel: "IMET",
    },
  };
}
