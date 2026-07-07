"use client";

import { useState } from "react";
import AgentTrace from "@/components/AgentTrace";
import type { AgentTraceEntry } from "@/lib/agent-events";

export type BulkAgentSlotStatus =
  | "pending"
  | "extracting"
  | "evaluating"
  | "done"
  | "error";

export type BulkAgentSlot = {
  rowId: string;
  slotIndex: number;
  projectName: string;
  fileName: string;
  status: BulkAgentSlotStatus;
  trace: AgentTraceEntry[];
  streamLine: string;
  errorMessage?: string;
};

function agentOrderKey(rowId: string): number {
  const m = /^bulk-(\d+)-/.exec(rowId);
  return m ? parseInt(m[1], 10) : 0;
}

function StatusSpinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-emerald-500 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg
      className="h-4 w-4 text-emerald-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="h-4 w-4 text-red-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function statusLabel(status: BulkAgentSlotStatus): string {
  switch (status) {
    case "pending":
      return "En cola";
    case "extracting":
      return "Extrayendo";
    case "evaluating":
      return "Evaluando";
    case "done":
      return "Finalizado";
    case "error":
      return "Error";
  }
}

function AgentWindow({ slot }: { slot: BulkAgentSlot }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = slot.status === "extracting" || slot.status === "evaluating";
  const isDone = slot.status === "done";
  const isError = slot.status === "error";

  return (
    <div
      className={`min-w-0 max-w-full overflow-hidden rounded-lg border ${
        isError
          ? "border-red-300 dark:border-red-800"
          : isDone
            ? "border-emerald-300 dark:border-emerald-800"
            : "border-border"
      } bg-surface-overlay/80`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 items-start gap-2 overflow-hidden px-3 py-2.5 text-left hover:bg-surface-hover"
      >
        <span className="mt-0.5 shrink-0">
          {isRunning ? (
            <StatusSpinner />
          ) : isDone ? (
            <SuccessIcon />
          ) : isError ? (
            <ErrorIcon />
          ) : (
            <span className="inline-block h-4 w-4 rounded-full border-2 border-border" />
          )}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium text-foreground">
              {slot.projectName}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">
              {statusLabel(slot.status)}
            </span>
          </span>
          <span
            className="mt-0.5 block truncate text-xs text-foreground-muted"
            title={slot.fileName}
          >
            {slot.fileName}
          </span>
          {!expanded && (
            <span
              className={`mt-1 block truncate text-xs ${
                isDone
                  ? "text-emerald-600 dark:text-emerald-400"
                  : isError
                    ? "text-red-600 dark:text-red-400"
                    : "text-foreground-muted"
              }`}
            >
              {isDone
                ? "Evaluación finalizada con éxito."
                : isError
                  ? slot.errorMessage ?? "Error en la evaluación."
                  : slot.streamLine}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-foreground-muted">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="min-w-0 max-w-full overflow-hidden border-t border-border px-3 py-2">
          {isDone ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Evaluación finalizada con éxito.
            </p>
          ) : isError ? (
            <p className="break-words text-sm text-red-600 dark:text-red-400">
              {slot.errorMessage ?? "Error en la evaluación."}
            </p>
          ) : (
            <div className="min-w-0 max-w-full overflow-hidden">
              <AgentTrace entries={slot.trace} isActive={isRunning} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BulkAgentPanel({ agents }: { agents: BulkAgentSlot[] }) {
  if (agents.length === 0) return null;

  const sorted = [...agents].sort((a, b) => agentOrderKey(a.rowId) - agentOrderKey(b.rowId));

  return (
    <div className="mb-3 min-w-0 max-w-full space-y-2">
      {sorted.map((slot) => (
        <AgentWindow key={slot.rowId} slot={slot} />
      ))}
    </div>
  );
}

