export type BulkEvaluationConfig = {
  parallelProjects: number;
  useClientKnowledgeIndex: boolean;
  preloadKnowledgeOnBulkStart: boolean;
};

export const BULK_EVALUATION_CONFIG_KEY = "bulk_evaluation_config";

export function defaultBulkEvaluationConfig(): BulkEvaluationConfig {
  return {
    parallelProjects: 2,
    useClientKnowledgeIndex: true,
    preloadKnowledgeOnBulkStart: true,
  };
}

export function mergeBulkEvaluationConfig(
  raw?: Partial<BulkEvaluationConfig> | null
): BulkEvaluationConfig {
  const base = defaultBulkEvaluationConfig();
  if (!raw || typeof raw !== "object") return base;

  const parallel = Number(raw.parallelProjects ?? base.parallelProjects);
  return {
    parallelProjects: Math.min(8, Math.max(1, Number.isFinite(parallel) ? Math.round(parallel) : base.parallelProjects)),
    useClientKnowledgeIndex: raw.useClientKnowledgeIndex ?? base.useClientKnowledgeIndex,
    preloadKnowledgeOnBulkStart: raw.preloadKnowledgeOnBulkStart ?? base.preloadKnowledgeOnBulkStart,
  };
}
