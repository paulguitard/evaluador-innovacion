import type { AgentTraceEntry } from "@/lib/agent-events";

/** Última línea visible para vista colapsada del agente. */
export function getLastStreamLine(
  trace: AgentTraceEntry[],
  fallback = "Iniciando…"
): string {
  const live = [...trace].reverse().find((t) => t.live);
  if (live?.title) return live.title;

  const last = trace[trace.length - 1];
  if (last?.title) return last.title;

  return fallback;
}
