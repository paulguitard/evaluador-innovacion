import type { SubdimensionQualityIssue } from "@/lib/report-completeness";

export type EvaluateSubdimAttemptRecord = {
  dimension: string;
  subdimension: string;
  attempt: number;
  ms?: number;
  acceptable: boolean;
  issues: SubdimensionQualityIssue[];
  chars: number;
};

const recentAttempts: EvaluateSubdimAttemptRecord[] = [];
const MAX_RECENT = 50;

export function recordEvaluateSubdimAttempt(record: EvaluateSubdimAttemptRecord): void {
  recentAttempts.push(record);
  if (recentAttempts.length > MAX_RECENT) recentAttempts.shift();
}

export function logEvaluateSubdimSummary(
  dimension: string,
  subdimension: string,
  outcome: "ok" | "failed",
  lastIssues?: SubdimensionQualityIssue[]
): void {
  const related = recentAttempts.filter(
    (r) => r.dimension === dimension && r.subdimension === subdimension
  );
  const retries = related.filter((r) => !r.acceptable).length;
  const last = related.at(-1);
  const lines = [
    `[evaluate-subdim] ${dimension} / ${subdimension} ${outcome}`,
    `  attempts: ${related.length} retries: ${retries} chars: ${last?.chars ?? "?"}`,
  ];
  if (lastIssues?.length) {
    lines.push(`  issues: ${lastIssues.join(", ")}`);
  }
  console.info(lines.join("\n"));
}

export function getRecentEvaluateSubdimAttempts(): EvaluateSubdimAttemptRecord[] {
  return [...recentAttempts];
}
