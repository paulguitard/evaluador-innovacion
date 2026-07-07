import {
  defaultBulkEvaluationConfig,
  mergeBulkEvaluationConfig,
  type BulkEvaluationConfig,
} from "@/lib/bulk-evaluation-config";
import {
  getBulkEvaluationConfigPostgres,
  saveBulkEvaluationConfigPostgres,
} from "@/lib/db-postgres";

export async function loadBulkEvaluationConfig(): Promise<BulkEvaluationConfig> {
  const fromDb = await getBulkEvaluationConfigPostgres();
  return mergeBulkEvaluationConfig(fromDb ?? undefined);
}

export async function saveBulkEvaluationConfig(config: BulkEvaluationConfig): Promise<void> {
  await saveBulkEvaluationConfigPostgres(mergeBulkEvaluationConfig(config));
}

export function getDefaultBulkEvaluationConfig(): BulkEvaluationConfig {
  return defaultBulkEvaluationConfig();
}
