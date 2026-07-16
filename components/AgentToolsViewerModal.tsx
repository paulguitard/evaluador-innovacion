"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AgentToolCategory,
  AgentToolEntry,
  AgentToolsCatalogResponse,
} from "@/lib/agent-tools-catalog";

const SOURCE_STYLES: Record<AgentToolEntry["source"], string> = {
  código: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  configuración:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
};

function ToolBlock({ tool }: { tool: AgentToolEntry }) {
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopySchema = async () => {
    try {
      await navigator.clipboard.writeText(tool.parametersSchema);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-600 dark:bg-[#1e1e1e]">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/80">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tool.title}</h4>
          <code className="rounded bg-gray-200/80 px-1.5 py-0.5 font-mono text-[11px] text-gray-800 dark:bg-gray-700 dark:text-gray-100">
            {tool.name}
          </code>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SOURCE_STYLES[tool.source]}`}
          >
            {tool.source}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-snug text-gray-600 dark:text-gray-300">
          {tool.description}
        </p>
      </div>

      <div className="space-y-2 px-3 py-2.5 text-xs leading-snug text-gray-600 dark:text-gray-300">
        <p>
          <span className="font-medium text-gray-700 dark:text-gray-200">Dónde se usa: </span>
          {tool.usedIn}
        </p>
        <p>
          <span className="font-medium text-gray-700 dark:text-gray-200">Implementación: </span>
          <code className="font-mono text-[11px]">{tool.implementedIn}</code>
        </p>
        {tool.configurableIn && (
          <p>
            <span className="font-medium text-gray-700 dark:text-gray-200">Configurable en: </span>
            {tool.configurableIn}
          </p>
        )}
      </div>

      <div className="border-t border-gray-100 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setSchemaOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/60"
        >
          <span>Parámetros (esquema JSON para el LLM)</span>
          <span className="text-gray-400">{schemaOpen ? "▲" : "▼"}</span>
        </button>
        {schemaOpen && (
          <div className="border-t border-gray-100 bg-white px-3 py-2 dark:border-gray-700 dark:bg-[#1e1e1e]">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={handleCopySchema}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {copied ? "Copiado" : "Copiar esquema"}
              </button>
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
              {tool.parametersSchema}
            </pre>
          </div>
        )}
      </div>
    </article>
  );
}

export default function AgentToolsViewerModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<AgentToolsCatalogResponse | null>(null);
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
    fetch("/api/agent-tools")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Error al cargar");
        return data as AgentToolsCatalogResponse;
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
        tools: category.tools.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.usedIn.toLowerCase().includes(q) ||
            t.implementedIn.toLowerCase().includes(q) ||
            (t.configurableIn?.toLowerCase().includes(q) ?? false)
        ),
      }))
      .filter((c) => c.tools.length > 0);
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

  const activeCategory: AgentToolCategory | undefined = filteredCategories.find(
    (c) => c.id === activeCategoryId
  );

  const totalTools = catalog?.categories.reduce((n, c) => n + c.tools.length, 0) ?? 0;
  const visibleTools = filteredCategories.reduce((n, c) => n + c.tools.length, 0);

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
                Herramientas del agente
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Catálogo de tools disponibles para el chat (niveles B/C) y la extracción de elementos.
                Solo lectura.
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
              placeholder="Buscar por nombre, descripción o uso…"
              className="min-w-[200px] flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            {catalog && (
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {visibleTools} / {totalTools} herramientas
              </span>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav
            className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/50"
            aria-label="Categorías de herramientas"
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
                            {category.tools.length} herramienta
                            {category.tools.length === 1 ? "" : "s"}
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
                No hay herramientas que coincidan con la búsqueda.
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
                    {activeCategory.tools.map((tool) => (
                      <ToolBlock key={tool.id} tool={tool} />
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
