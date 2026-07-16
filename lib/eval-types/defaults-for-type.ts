import { isImet } from "./constants";
import {
  igipExtractDefault,
  igipEvaluationDefaults,
  igipReportFormatDefault,
  igipRubricDefault,
  igipTypeSettings,
} from "./igip";
import {
  imetExtractDefault,
  imetEvaluationDefaults,
  imetReportFormatDefault,
  imetRubricDefault,
  imetTypeSettings,
} from "./imet";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { ExtractConfig, EvaluationTypeSettings } from "@/lib/evaluation-type-settings";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";

export function defaultsForType(name?: string | null): {
  rubric: RubricConfig;
  extract: ExtractConfig;
  evaluation: EvaluationConfig;
  reportFormat: ReportFormatConfig;
  typeSettings: EvaluationTypeSettings;
} {
  if (isImet(name)) {
    return {
      rubric: imetRubricDefault(),
      extract: imetExtractDefault(),
      evaluation: imetEvaluationDefaults(),
      reportFormat: imetReportFormatDefault(),
      typeSettings: imetTypeSettings(),
    };
  }
  return {
    rubric: igipRubricDefault(),
    extract: igipExtractDefault(),
    evaluation: igipEvaluationDefaults(),
    reportFormat: igipReportFormatDefault(),
    typeSettings: igipTypeSettings(),
  };
}
