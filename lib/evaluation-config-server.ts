import "server-only";

import { getConfig, getEvaluationTypeById } from "@/lib/db";
import { mergeEvaluationConfig, type EvaluationConfig } from "@/lib/evaluation-config";

function parseJson(raw: string | undefined): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export async function getEvaluationConfig(evaluationTypeId: number): Promise<EvaluationConfig> {
  const [config, type] = await Promise.all([
    getConfig(evaluationTypeId),
    getEvaluationTypeById(evaluationTypeId),
  ]);
  if (!config) {
    return mergeEvaluationConfig(null, type?.name);
  }
  return mergeEvaluationConfig(
    {
      evaluation_config: parseJson(config.evaluation_config),
      pipeline_config: parseJson(config.pipeline_config),
      report_format_config: parseJson(config.report_format_config),
      rag_config: parseJson(config.rag_config),
    },
    type?.name
  );
}
