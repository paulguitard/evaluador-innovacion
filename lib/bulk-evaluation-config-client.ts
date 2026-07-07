import {
  defaultBulkEvaluationConfig,
  mergeBulkEvaluationConfig,
  type BulkEvaluationConfig,
} from "@/lib/bulk-evaluation-config";

let cachedConfig: BulkEvaluationConfig | null = null;
let cachePromise: Promise<BulkEvaluationConfig> | null = null;

export async function fetchBulkEvaluationConfig(
  force = false
): Promise<BulkEvaluationConfig> {
  if (!force && cachedConfig) return cachedConfig;
  if (!force && cachePromise) return cachePromise;

  cachePromise = fetch("/api/bulk-evaluation-config")
    .then((r) => {
      if (!r.ok) throw new Error("No se pudo cargar configuración masiva");
      return r.json();
    })
    .then((data) => {
      const merged = mergeBulkEvaluationConfig(data);
      cachedConfig = merged;
      return merged;
    })
    .finally(() => {
      cachePromise = null;
    });

  return cachePromise;
}

export function invalidateBulkEvaluationConfigCache(): void {
  cachedConfig = null;
}

export { defaultBulkEvaluationConfig };
