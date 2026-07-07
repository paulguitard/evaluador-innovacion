import "server-only";

import { getConfig, getEvaluationTypeById } from "@/lib/db";
import {
  mergeEvaluationTypeSettings,
  type EvaluationTypeSettings,
} from "@/lib/evaluation-type-settings";

export async function getEvaluationTypeSettings(
  evaluationTypeId: number
): Promise<EvaluationTypeSettings> {
  const [config, type] = await Promise.all([
    getConfig(evaluationTypeId),
    getEvaluationTypeById(evaluationTypeId),
  ]);
  if (!config) {
    return mergeEvaluationTypeSettings(null, type?.name);
  }
  let pipeline_config: unknown;
  let rag_config: unknown;
  let extract_config: unknown;
  try {
    pipeline_config = JSON.parse(config.pipeline_config || "{}");
  } catch {
    pipeline_config = {};
  }
  try {
    rag_config = JSON.parse(config.rag_config || "{}");
  } catch {
    rag_config = {};
  }
  try {
    extract_config = JSON.parse(config.extract_config || "{}");
  } catch {
    extract_config = {};
  }
  return mergeEvaluationTypeSettings(
    { pipeline_config, rag_config, extract_config },
    type?.name
  );
}
