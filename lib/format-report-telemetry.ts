/** Telemetría de latencia para la fase §6 de formateo del informe. */

export type FormatSectionAttemptRecord = {
  sectionId: string;
  sectionTitle: string;
  attempt: number;
  round: "primary" | "final";
  ms: number;
  acceptable: boolean;
  reason?: string;
  chars: number;
};

export type FormatPhaseTiming = {
  phase: "prefetch" | "synthesis" | "assemble" | "total";
  ms: number;
};

export type FormatReportTelemetry = {
  recordAttempt: (record: FormatSectionAttemptRecord) => void;
  recordPhase: (timing: FormatPhaseTiming) => void;
  logSummary: (context?: string) => void;
  getAttempts: () => FormatSectionAttemptRecord[];
  getPhases: () => FormatPhaseTiming[];
};

export function createFormatReportTelemetry(): FormatReportTelemetry {
  const attempts: FormatSectionAttemptRecord[] = [];
  const phases: FormatPhaseTiming[] = [];

  return {
    recordAttempt(record) {
      attempts.push(record);
    },
    recordPhase(timing) {
      phases.push(timing);
    },
    getAttempts() {
      return [...attempts];
    },
    getPhases() {
      return [...phases];
    },
    logSummary(context) {
      const totalMs = phases.find((p) => p.phase === "total")?.ms;
      const prefetchMs = phases.find((p) => p.phase === "prefetch")?.ms;
      const synthesisMs = phases.find((p) => p.phase === "synthesis")?.ms;
      const rejected = attempts.filter((a) => !a.acceptable);
      const retriedSections = new Set(
        attempts.filter((a) => a.attempt > 0 || a.round === "final").map((a) => a.sectionId)
      );

      const slowest = [...attempts]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3)
        .map((a) => `${a.sectionTitle}=${Math.round(a.ms / 1000)}s`)
        .join(", ");

      const lines = [
        `[format-report]${context ? ` ${context}` : ""}`,
        `  phases: prefetch=${prefetchMs ?? "?"}ms synthesis=${synthesisMs ?? "?"}ms total=${totalMs ?? "?"}ms`,
        `  llm_calls: ${attempts.length} sections_retried: ${retriedSections.size}`,
      ];

      if (slowest) {
        lines.push(`  slowest: ${slowest}`);
      }

      if (rejected.length > 0) {
        const reasons = rejected
          .slice(-5)
          .map((a) => `${a.sectionTitle}#${a.attempt}(${a.reason ?? "unknown"})`)
          .join(", ");
        lines.push(`  recent_rejections: ${reasons}`);
      }

      console.info(lines.join("\n"));
    },
  };
}
