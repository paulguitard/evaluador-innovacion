"use client";

import { useState, useEffect, useRef } from "react";

type EvaluationType = { id: number; name: string };
type KnowledgeItem = string | { name: string; url: string };
type ElementDef = { title: string; description: string; section?: string };
type Config = {
  prompt: string;
  knowledge_paths: KnowledgeItem[];
  rubric_path: string;
  elements: ElementDef[];
  instructions: string;
  report_format: string;
  rubric_prompt: string;
};

const defaultConfig: Config = {
  prompt: "",
  knowledge_paths: [],
  rubric_path: "",
  elements: [],
  instructions: "",
  report_format: "",
  rubric_prompt: "",
};

export default function ConfigPanel({
  isOpen,
  onClose,
  types,
  activeId,
  onTypesChange,
  onSelectType,
}: {
  isOpen: boolean;
  onClose: () => void;
  types: EvaluationType[];
  activeId: number | null;
  onTypesChange: () => void;
  onSelectType: (id: number) => void;
}) {
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [newTypeName, setNewTypeName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showElementModal, setShowElementModal] = useState(false);
  const [editingElementIndex, setEditingElementIndex] = useState<number | null>(null);
  const [elementForm, setElementForm] = useState({ title: "", description: "", section: "General" });

  useEffect(() => {
    if (isOpen && activeId) setSelectedTypeId(activeId);
  }, [isOpen, activeId]);

  useEffect(() => {
    if (!selectedTypeId) {
      setConfig(defaultConfig);
      return;
    }
    setLoading(true);
    fetch(`/api/config/${selectedTypeId}`)
      .then((r) => r.json())
      .then((data) => {
        const elements = Array.isArray(data.elements)
          ? data.elements.filter(
              (e: unknown) =>
                typeof e === "object" && e != null && "title" in e && "description" in e
            )
          : [];
        setConfig({
          prompt: data.prompt ?? "",
          knowledge_paths: Array.isArray(data.knowledge_paths) ? data.knowledge_paths : [],
          rubric_path: data.rubric_path ?? "",
          elements: elements.map((e: { title: string; description: string; section?: string }) => ({
            title: String(e.title ?? ""),
            description: String(e.description ?? ""),
            section: typeof (e as { section?: string }).section === "string" ? (e as { section: string }).section : "General",
          })),
          instructions: data.instructions ?? "",
          report_format: data.report_format ?? "",
          rubric_prompt: data.rubric_prompt ?? "",
        });
      })
      .catch(() => setConfig(defaultConfig))
      .finally(() => setLoading(false));
  }, [selectedTypeId]);

  const handleCreateType = async () => {
    const name = newTypeName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/evaluation-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(typeof errBody?.error === "string" ? errBody.error : "Error");
      }
      onTypesChange();
      const data = await res.json();
      setSelectedTypeId(data.id);
      onSelectType(data.id);
      setNewTypeName("");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteType = async (id: number) => {
    if (!confirm("¿Eliminar este tipo de evaluación?")) return;
    const res = await fetch(`/api/evaluation-types/${id}`, { method: "DELETE" });
    if (res.ok) {
      onTypesChange();
      if (selectedTypeId === id) setSelectedTypeId(types[0]?.id ?? null);
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedTypeId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/config/${selectedTypeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elements: config.elements,
          instructions: config.instructions,
          report_format: config.report_format,
          rubric_prompt: config.rubric_prompt,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadKnowledge = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !selectedTypeId) return;
    const form = new FormData();
    form.set("kind", "knowledge");
    form.set("evaluationTypeId", String(selectedTypeId));
    for (let i = 0; i < files.length; i++) form.append("files", files[i]);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    if (res.ok) {
      const data = await res.json();
      setConfig((c) => ({ ...c, knowledge_paths: data.knowledge_paths ?? c.knowledge_paths }));
      onTypesChange();
    }
    e.target.value = "";
  };

  const existingSections = Array.from(
    new Set(config.elements.map((e) => (e.section ?? "General").trim()).filter(Boolean))
  ).sort();
  const sectionColors: { bg: string; border: string; card: string }[] = [
    { bg: "bg-sky-100 dark:bg-sky-900/40", border: "border-sky-400 dark:border-sky-600", card: "bg-sky-200/80 dark:bg-sky-800/60 border-sky-300 dark:border-sky-700" },
    { bg: "bg-emerald-100 dark:bg-emerald-900/40", border: "border-emerald-400 dark:border-emerald-600", card: "bg-emerald-200/80 dark:bg-emerald-800/60 border-emerald-300 dark:border-emerald-700" },
    { bg: "bg-amber-100 dark:bg-amber-900/40", border: "border-amber-400 dark:border-amber-600", card: "bg-amber-200/80 dark:bg-amber-800/60 border-amber-300 dark:border-amber-700" },
    { bg: "bg-violet-100 dark:bg-violet-900/40", border: "border-violet-400 dark:border-violet-600", card: "bg-violet-200/80 dark:bg-violet-800/60 border-violet-300 dark:border-violet-700" },
    { bg: "bg-rose-100 dark:bg-rose-900/40", border: "border-rose-400 dark:border-rose-600", card: "bg-rose-200/80 dark:bg-rose-800/60 border-rose-300 dark:border-rose-700" },
    { bg: "bg-teal-100 dark:bg-teal-900/40", border: "border-teal-400 dark:border-teal-600", card: "bg-teal-200/80 dark:bg-teal-800/60 border-teal-300 dark:border-teal-700" },
    { bg: "bg-orange-100 dark:bg-orange-900/40", border: "border-orange-400 dark:border-orange-600", card: "bg-orange-200/80 dark:bg-orange-800/60 border-orange-300 dark:border-orange-700" },
    { bg: "bg-indigo-100 dark:bg-indigo-900/40", border: "border-indigo-400 dark:border-indigo-600", card: "bg-indigo-200/80 dark:bg-indigo-800/60 border-indigo-300 dark:border-indigo-700" },
  ];
  const getSectionColor = (sectionName: string) => {
    const ordered = Array.from(new Set(config.elements.map((e) => e.section ?? "General")));
    const idx = ordered.indexOf(sectionName);
    return sectionColors[Math.max(0, idx) % sectionColors.length];
  };

  const openAddElementModal = () => {
    setElementForm({ title: "", description: "", section: existingSections[0] ?? "General" });
    setEditingElementIndex(null);
    setShowElementModal(true);
  };
  const openEditElementModal = (index: number) => {
    const el = config.elements[index];
    setElementForm({
      title: el.title,
      description: el.description,
      section: el.section ?? "General",
    });
    setEditingElementIndex(index);
    setShowElementModal(true);
  };
  const saveElementFromModal = () => {
    const section = elementForm.section.trim() || "General";
    const next: ElementDef = {
      title: elementForm.title.trim(),
      description: elementForm.description.trim(),
      section,
    };
    if (editingElementIndex !== null) {
      setConfig((c) => ({
        ...c,
        elements: c.elements.map((e, i) => (i === editingElementIndex ? next : e)),
      }));
    } else {
      setConfig((c) => ({ ...c, elements: [...c.elements, next] }));
    }
    setShowElementModal(false);
    setEditingElementIndex(null);
  };
  const removeElement = (index: number) => {
    setConfig((c) => ({ ...c, elements: c.elements.filter((_, i) => i !== index) }));
  };
  const removeSection = (sectionName: string) => {
    const norm = (s: string) => (s || "General").trim() || "General";
    const target = norm(sectionName);
    if (!confirm(`¿Eliminar la sección "${sectionName}" y todos sus elementos?`)) return;
    const currentNorm = norm(elementForm.section);
    const elementsAfter = config.elements.filter((el) => norm(el.section ?? "General") !== target);
    const remainingSections = Array.from(new Set(elementsAfter.map((el) => (el.section ?? "General").trim() || "General")));
    if (currentNorm === target) {
      setElementForm((f) => ({ ...f, section: remainingSections[0] ?? "" }));
    }
    setConfig((c) => ({ ...c, elements: elementsAfter }));
  };

  const knowledgeInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const sectionClass =
    "rounded-lg border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-600 dark:bg-gray-800/60";
  const sectionTitleClass = "text-sm font-semibold text-gray-800 dark:text-gray-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex h-[90vh] w-full max-w-[95vw] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-600">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Configuración</h2>
          <div className="flex items-center gap-2">
            {selectedTypeId && (
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={saving}
                className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Guardar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-[1fr_1fr] gap-6 overflow-hidden p-6">
          {/* Celda uniforme: todas las secciones mismo ancho y alto */}
          <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
            <h3 className={sectionTitleClass}>1. Tipo de evaluación</h3>
            <p className="mt-0.5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
              Cree un tipo o seleccione uno existente. La configuración aplica al tipo seleccionado.
            </p>
            <div className="mt-3 flex shrink-0 gap-2">
              <input
                type="text"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="Nombre del tipo (ej. IGIP, TRL)"
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleCreateType}
                disabled={saving || !newTypeName.trim()}
                className="rounded bg-[#4b5563] px-4 py-2 text-sm font-medium text-white hover:bg-[#374151] dark:bg-[#6b7280] dark:hover:bg-[#4b5563] disabled:opacity-50"
              >
                Crear
              </button>
            </div>
            {types.length > 0 && (
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Seleccionar tipo:</span>
                <ul className="mt-1 space-y-1">
                  {types.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTypeId(t.id)}
                        className={`flex-1 rounded px-3 py-2 text-left text-sm ${
                          selectedTypeId === t.id
                            ? "bg-gray-300 font-medium dark:bg-gray-600 dark:text-white"
                            : "hover:bg-gray-200 dark:hover:bg-gray-700"
                        }`}
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteType(t.id)}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      >
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <h3 className={sectionTitleClass}>2. Documentos de referencia (Knowledge)</h3>
              <p className="mt-0.5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                Archivos que el evaluador usará como base de conocimiento (PDF, Word, Excel, texto, etc.).
              </p>
              <input
                ref={knowledgeInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.json"
                className="sr-only"
                onChange={handleUploadKnowledge}
              />
              <button
                type="button"
                onClick={() => knowledgeInputRef.current?.click()}
                className="mt-3 flex shrink-0 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white py-4 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700"
              >
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Subir documentos de referencia
              </button>
              {config.knowledge_paths.length > 0 && (
                <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded bg-gray-100 px-2 py-2 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  <span className="font-medium">Archivos cargados:</span>
                  {config.knowledge_paths.map((p, i) => (
                    <li key={i} className="truncate pl-1">{typeof p === "string" ? p : p.name}</li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`}>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Seleccione un tipo o cree uno nuevo para configurar documentos y el resto.
              </p>
            </section>
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <h3 className={sectionTitleClass}>3. Elementos a identificar</h3>
              <p className="mt-0.5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                Defina los elementos (título y descripción) que el LLM buscará en el Excel extraído para mostrar en &quot;Proyecto extraído&quot;. Agrupe por sección.
              </p>
              <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
                {(() => {
                  const bySection = new Map<string, { element: ElementDef; index: number }[]>();
                  config.elements.forEach((el, i) => {
                    const sec = (el.section ?? "General").trim() || "General";
                    if (!bySection.has(sec)) bySection.set(sec, []);
                    bySection.get(sec)!.push({ element: el, index: i });
                  });
                  return Array.from(bySection.entries()).map(([secName, items]) => {
                    const colors = getSectionColor(secName);
                    return (
                      <div
                        key={secName}
                        className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-2.5`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                            {secName}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeSection(secName)}
                            className="rounded p-1 text-gray-500 hover:bg-red-200 hover:text-red-700 dark:hover:text-red-400"
                            title="Eliminar sección y todos sus elementos"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map(({ element: el, index }) => (
                            <div
                              key={index}
                              className={`flex items-center gap-1 rounded border ${colors.card} px-2 py-1 text-sm shadow-sm`}
                            >
                              <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100" title={el.title}>
                                {el.title || "(Sin título)"}
                              </span>
                              <button
                                type="button"
                                onClick={() => openEditElementModal(index)}
                                className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 dark:hover:text-gray-300"
                                title="Editar"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeElement(index)}
                                className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-red-200 hover:text-red-700 dark:hover:text-red-400"
                                title="Quitar"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <button
                type="button"
                onClick={openAddElementModal}
                className="mt-2 shrink-0 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                Añadir elemento
              </button>
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <h3 className={sectionTitleClass}>4. Rúbrica</h3>
              <p className="mt-0.5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                Texto de la rúbrica: criterios, niveles y ponderaciones. El LLM usará esto para evaluar.
              </p>
              <textarea
                value={config.rubric_prompt}
                onChange={(e) => setConfig((c) => ({ ...c, rubric_prompt: e.target.value }))}
                rows={6}
                className="mt-3 min-h-0 flex-1 resize-none rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Describa la rúbrica: dimensiones, subcriterios, niveles (1-4), porcentajes..."
              />
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <h3 className={sectionTitleClass}>5. Instrucciones</h3>
              <p className="mt-0.5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                Instrucciones y contexto general para que el LLM realice la evaluación según elementos, contenidos y rúbrica.
              </p>
              <textarea
                value={config.instructions}
                onChange={(e) => setConfig((c) => ({ ...c, instructions: e.target.value }))}
                rows={6}
                className="mt-3 min-h-0 flex-1 resize-none rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Ej.: Evalúa el proyecto usando el manual de Oslo y la rúbrica. Basa las notas en los elementos identificados..."
              />
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <h3 className={sectionTitleClass}>6. Formato de informe</h3>
              <p className="mt-0.5 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                Estructura, secciones y presentación del informe de evaluación.
              </p>
              <textarea
                value={config.report_format}
                onChange={(e) => setConfig((c) => ({ ...c, report_format: e.target.value }))}
                rows={6}
                className="mt-3 min-h-0 flex-1 resize-none rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Ej.: Incluye: 1. Resumen, 2. Notas por dimensión, 3. Justificación por criterio, 4. Recomendaciones..."
              />
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}
        </div>

        {showElementModal && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowElementModal(false)}
          >
            <div
              className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-600 dark:bg-[#252526]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {editingElementIndex !== null ? "Editar elemento" : "Añadir elemento"}
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Título</label>
                  <input
                    type="text"
                    value={elementForm.title}
                    onChange={(e) => setElementForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Ej. Nombre del proyecto"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Descripción</label>
                  <textarea
                    value={elementForm.description}
                    onChange={(e) => setElementForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Ej. nombre o título principal, suele ser la letra más grande"
                    rows={2}
                    className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Sección</label>
                  {(() => {
                    const sectionOptions = Array.from(new Set(existingSections)).sort((a, b) => (a === "General" ? -1 : a.localeCompare(b)));
                    const selectValue = sectionOptions.includes(elementForm.section) ? elementForm.section : "__new__";
                    return (
                      <>
                        <select
                          value={selectValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            setElementForm((f) => ({ ...f, section: v === "__new__" ? "" : v }));
                          }}
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        >
                          {sectionOptions.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                          <option value="__new__">➕ Nueva sección (escribir abajo)</option>
                        </select>
                        {selectValue === "__new__" && (
                          <input
                            type="text"
                            value={elementForm.section}
                            onChange={(e) => setElementForm((f) => ({ ...f, section: e.target.value }))}
                            placeholder="Nombre de la nueva sección (ej. Información General, Presupuesto)"
                            className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            autoFocus
                          />
                        )}
                        {existingSections.length > 0 && (
                          <div className="mt-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">Eliminar sección de la lista: </span>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {existingSections.sort((a, b) => (a === "General" ? -1 : a.localeCompare(b))).map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex items-center gap-1 rounded bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700"
                                >
                                  {s}
                                  <button
                                    type="button"
                                    onClick={() => removeSection(s)}
                                    className="rounded p-0.5 text-gray-500 hover:bg-red-200 hover:text-red-700 dark:hover:text-red-400"
                                    title={`Eliminar sección "${s}" y todos sus elementos`}
                                  >
                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowElementModal(false)}
                  className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveElementFromModal}
                  disabled={!elementForm.title.trim()}
                  className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {editingElementIndex !== null ? "Guardar" : "Añadir"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
