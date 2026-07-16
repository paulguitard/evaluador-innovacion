"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SystemPromptCategory,
  SystemPromptEntry,
  SystemPromptsCatalogResponse,
} from "@/lib/system-prompts-catalog";

const SOURCE_STYLES: Record<SystemPromptEntry["source"], string> = {
  código: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  configuración:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  dinámico: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
};

function PromptBlock({ prompt }: { prompt: SystemPromptEntry }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-600 dark:bg-[#1e1e1e]">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/80">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{prompt.title}</h4>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SOURCE_STYLES[prompt.source]}`}
              >
                {prompt.source}
              </span>
            </div>
            <p className="mt-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
              {prompt.description}
            </p>
            {prompt.editableIn && (
              <p className="mt-1 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                Editar en: {prompt.editableIn}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto overscroll-contain border-t border-gray-100 bg-white p-3 dark:border-gray-700 dark:bg-[#1e1e1e]">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
          {prompt.content.trim() || "(vacío)"}
        </pre>
      </div>
    </article>
  );
}

export default function SystemPromptViewerModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<SystemPromptsCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setQuery("");
    setActiveCategoryId(null);
    fetch("/api/system-prompts")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Error al cargar");
        return data as SystemPromptsCatalogResponse;
      })
      .then((data) => {
        setCatalog(data);
        setActiveCategoryId(data.categories[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el catálogo."))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const filteredCategories = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    if (!q) return catalog.categories;

    return catalog.categories
      .map((category) => ({
        ...category,
        prompts: category.prompts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.prompts.length > 0);
  }, [catalog, query]);

  useEffect(() => {
    if (filteredCategories.length === 0) {
      setActiveCategoryId(null);
      return;
    }
    if (!activeCategoryId || !filteredCategories.some((c) => c.id === activeCategoryId)) {
      setActiveCategoryId(filteredCategories[0].id);
    }
  }, [filteredCategories, activeCategoryId]);

  const activeCategory: SystemPromptCategory | undefined = filteredCategories.find(
    (c) => c.id === activeCategoryId
  );

  const totalPrompts = catalog?.categories.reduce((n, c) => n + c.prompts.length, 0) ?? 0;
  const visiblePrompts = filteredCategories.reduce((n, c) => n + c.prompts.length, 0);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-gray-200 px-5 py-4 dark:border-gray-600">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                System prompts de la aplicación
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Catálogo completo (IGIP, IMET y global). Solo lectura.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Cerrar
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título, descripción o texto…"
              className="min-w-[200px] flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            {catalog && (
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {visiblePrompts} / {totalPrompts} prompts
              </span>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav
            className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/50"
            aria-label="Categorías de system prompts"
          >
            <div className="shrink-0 border-b border-gray-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Categorías
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {loading ? (
                <p className="px-2 py-1 text-xs text-gray-500">Cargando…</p>
              ) : filteredCategories.length === 0 ? (
                <p className="px-2 py-1 text-xs text-gray-500">Sin resultados</p>
              ) : (
                <ul className="space-y-1">
                  {filteredCategories.map((category) => {
                    const active = category.id === activeCategoryId;
                    return (
                      <li key={category.id}>
                        <button
                          type="button"
                          onClick={() => setActiveCategoryId(category.id)}
                          className={`w-full rounded-md px-2.5 py-2 text-left transition ${
                            active
                              ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-600"
                              : "text-gray-600 hover:bg-white/80 dark:text-gray-300 dark:hover:bg-gray-800/60"
                          }`}
                        >
                          <div className="text-xs font-medium leading-snug">{category.title}</div>
                          <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                            {category.prompts.length} prompt
                            {category.prompts.length === 1 ? "" : "s"}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </nav>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-[#252526]">
            {error ? (
              <div className="p-4">
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                  {error}
                </p>
              </div>
            ) : loading ? (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Cargando catálogo…</div>
            ) : !activeCategory ? (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                No hay prompts que coincidan con la búsqueda.
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-900/40">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {activeCategory.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                    {activeCategory.description}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                  <div className="flex flex-col gap-4">
                    {activeCategory.prompts.map((prompt) => (
                      <PromptBlock key={prompt.id} prompt={prompt} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        {catalog?.generatedAt && (
          <footer className="shrink-0 border-t border-gray-200 px-5 py-2 text-[10px] text-gray-400 dark:border-gray-600">
            Generado: {new Date(catalog.generatedAt).toLocaleString("es")}
          </footer>
        )}
      </div>
    </div>
  );
}
