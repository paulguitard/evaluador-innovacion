import type { AgentTraceEntry } from "@/lib/agent-events";

/** Pausa antes del primer paso visible. */
export const TRACE_FIRST_STEP_MS = 200;
/** Pausa entre pasos sucesivos de la traza. */
export const TRACE_STEP_MS = 450;

export type RevealedChatState = {
  trace: AgentTraceEntry[];
  content: string;
  revealing: boolean;
};

export function createStaggeredTraceReveal(
  onUpdate: (state: RevealedChatState) => void,
  options?: { firstStepMs?: number; stepMs?: number }
) {
  const firstStepMs = options?.firstStepMs ?? TRACE_FIRST_STEP_MS;
  const stepMs = options?.stepMs ?? TRACE_STEP_MS;

  let targetTrace: AgentTraceEntry[] = [];
  let targetContent = "";
  let visibleCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fullyRevealedListeners: Array<() => void> = [];

  function notifyFullyRevealedIfIdle() {
    if (visibleCount < targetTrace.length || timer != null) return;
    const listeners = fullyRevealedListeners.splice(0);
    for (const fn of listeners) fn();
  }

  function buildVisibleTrace(): AgentTraceEntry[] {
    return targetTrace.slice(0, visibleCount).map((entry, i) => {
      const latest = targetTrace[i];
      if (!latest || latest.id !== entry.id) return entry;
      return { ...latest };
    });
  }

  function flush() {
    const revealing = visibleCount < targetTrace.length;
    onUpdate({
      trace: buildVisibleTrace(),
      content: revealing ? "" : targetContent,
      revealing,
    });
    if (!revealing) notifyFullyRevealedIfIdle();
  }

  function scheduleNext() {
    if (visibleCount >= targetTrace.length) {
      timer = null;
      flush();
      return;
    }
    const delay = visibleCount === 0 ? firstStepMs : stepMs;
    timer = setTimeout(() => {
      visibleCount += 1;
      flush();
      scheduleNext();
    }, delay);
  }

  function ensureScheduling() {
    if (timer != null) return;
    if (visibleCount < targetTrace.length) {
      scheduleNext();
    } else {
      flush();
    }
  }

  return {
    setState(trace: AgentTraceEntry[], content: string) {
      targetTrace = trace;
      targetContent = content;
      if (visibleCount > targetTrace.length) {
        visibleCount = targetTrace.length;
      }
      if (visibleCount < targetTrace.length) {
        ensureScheduling();
      } else {
        flush();
      }
    },

    /** Muestra toda la traza y el contenido de inmediato (error, cancelación). */
    flushAll() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      visibleCount = targetTrace.length;
      onUpdate({
        trace: targetTrace.map((e) => ({ ...e })),
        content: targetContent,
        revealing: false,
      });
    },

    reset() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      targetTrace = [];
      targetContent = "";
      visibleCount = 0;
    },

    destroy() {
      fullyRevealedListeners.length = 0;
      this.reset();
    },

    /** Ejecuta el callback cuando la traza visible alcanzó el total y no hay timers pendientes. */
    onFullyRevealed(cb: () => void) {
      if (visibleCount >= targetTrace.length && timer == null) {
        cb();
      } else {
        fullyRevealedListeners.push(cb);
      }
    },
  };
}
