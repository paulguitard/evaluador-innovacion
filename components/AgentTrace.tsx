"use client";

import { useState } from "react";
import type { AgentChunkPreview, AgentTraceEntry } from "@/lib/agent-events";

export type { AgentTraceEntry };

const KIND_STYLES: Record<AgentTraceEntry["kind"], string> = {
  step: "text-foreground-muted",
  plan: "text-accent",
  intent: "text-foreground",
  tool: "text-foreground-muted",
  rag: "text-accent",
  chunks: "text-accent/80",
  context: "text-foreground-muted",
  thinking: "text-foreground-muted",
  answer: "text-foreground",
};

const KIND_ICONS: Record<AgentTraceEntry["kind"], string> = {
  step: "◎",
  plan: "◆",
  intent: "◈",
  tool: "⚙",
  rag: "⌕",
  chunks: "▤",
  context: "▣",
  thinking: "◐",
  answer: "✎",
};

function ChunkList({ chunks }: { chunks: AgentChunkPreview[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-accent underline decoration-dotted hover:text-accent/80"
      >
        {open ? "Ocultar" : "Ver"} {chunks.length} fragmento(s)
      </button>
      {open && (
        <ul className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto rounded border border-border bg-surface-overlay/80 p-2">
          {chunks.map((c) => (
            <li key={c.id} className="text-xs text-foreground-muted">
              <div className="font-medium text-foreground">
                {c.docName}
                {c.printedPage != null
                  ? ` · pág. ${c.printedPage}`
                  : c.page != null
                    ? ` · PDF ${c.page}`
                    : ""}
                <span className="ml-1 font-normal text-foreground-muted">
                  (score {c.score}, {c.charCount.toLocaleString("es")} car.)
                </span>
              </div>
              <p className="mt-0.5 text-foreground-muted">{c.preview}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(live ?? false);
  if (!text.trim()) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-accent underline decoration-dotted hover:text-accent/80"
      >
        {open ? "Ocultar razonamiento" : "Ver razonamiento del modelo"}
        {live && open ? " (en vivo…)" : ""}
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border-subtle bg-surface-raised/80 p-2 text-xs text-foreground-muted">
          {text}
        </pre>
      )}
    </div>
  );
}

export default function AgentTrace({
  entries,
  isActive,
  isRevealing,
}: {
  entries: AgentTraceEntry[];
  isActive?: boolean;
  /** Hay pasos en cola que aún no se muestran (revelado escalonado). */
  isRevealing?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (entries.length === 0 && !isActive) return null;

  return (
    <div className="mb-2 max-w-full min-w-0 overflow-hidden rounded-lg border border-dashed border-border-subtle bg-surface-raised/70">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Actividad del agente
          {isActive && (
            <span className="ml-2 inline-flex items-center gap-1 font-normal normal-case text-foreground-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              en curso
            </span>
          )}
        </span>
        <span className="text-xs text-foreground-muted">{collapsed ? "Mostrar" : "Ocultar"}</span>
      </button>
      {!collapsed && (
        <ol className="space-y-2 border-t border-border px-2.5 py-2">
          {entries.map((entry) => (
            <li key={entry.id} className="agent-trace-step-in flex gap-2 text-xs">
              <span className={`mt-0.5 shrink-0 ${KIND_STYLES[entry.kind]}`} aria-hidden>
                {KIND_ICONS[entry.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${KIND_STYLES[entry.kind]}`}>{entry.title}</p>
                {entry.detail && (
                  <p className="mt-0.5 text-foreground-muted">{entry.detail}</p>
                )}
                {entry.chunks && entry.chunks.length > 0 && (
                  <ChunkList chunks={entry.chunks} />
                )}
                {entry.thinkingText && (
                  <ThinkingBlock text={entry.thinkingText} live={entry.live} />
                )}
              </div>
            </li>
          ))}
          {isActive && entries.length === 0 && (
            <li className="text-xs text-foreground-muted">Iniciando…</li>
          )}
          {isRevealing && (
            <li className="flex gap-2 text-xs text-foreground-muted">
              <span className="mt-0.5 inline-block h-3 w-3 animate-pulse rounded-full bg-foreground-muted/50" aria-hidden />
              <span>Preparando siguiente paso…</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
