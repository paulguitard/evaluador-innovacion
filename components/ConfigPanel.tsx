"use client";

import { useState, useEffect, useRef } from "react";
import { upload } from "@vercel/blob/client";
import { ExpandIcon } from "@/components/FullscreenOverlay";
import LlmConfigModal from "@/components/LlmConfigModal";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import { MAX_VERCEL_SERVER_UPLOAD_BYTES } from "@/lib/upload-limits";

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
  const [indexingKnowledge, setIndexingKnowledge] = useState(false);
  const [knowledgeIndexStatus, setKnowledgeIndexStatus] = useState<string | null>(null);
  const [llmConfigOpen, setLlmConfigOpen] = useState(false);
  const [ragStatus, setRagStatus] = useState<{
    hasIndex: boolean;
    chunkCount: number;
    indexedAt: string | null;
    chunksFileBytes: number;
    knowledgeConfigured: boolean;
  } | null>(null);

  const refreshRagStatus = (typeId: number) => {
    fetch(`/api/config/${typeId}/rag-status`)
      .then((r) => r.json())
      .then((data) => {
        if (typeof data?.chunkCount === "number") {
          setRagStatus({
            hasIndex: !!data.hasIndex,
            chunkCount: data.chunkCount,
            indexedAt: data.indexedAt ?? null,
            chunksFileBytes: data.chunksFileBytes ?? 0,
            knowledgeConfigured: !!data.knowledgeConfigured,
          });
        }
      })
      .catch(() => setRagStatus(null));
  };
  const [showElementModal, setShowElementModal] = useState(false);
  const [editingElementIndex, setEditingElementIndex] = useState<number | null>(null);
  const [elementForm, setElementForm] = useState({ title: "", description: "", section: "General" });
  type ExpandSectionId = "elements" | "rubric" | "instructions" | "reportFormat";
  const [expandSection, setExpandSection] = useState<ExpandSectionId | null>(null);

  useEffect(() => {
    if (!expandSection) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandSection(null);
    };
    window.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [expandSection]);

  useEffect(() => {
    if (isOpen && activeId) setSelectedTypeId(activeId);
  }, [isOpen, activeId]);

  useEffect(() => {
    if (!selectedTypeId) {
      setConfig(defaultConfig);
      setRagStatus(null);
      setKnowledgeIndexStatus(null);
      return;
    }
    setRagStatus(null);
    setKnowledgeIndexStatus(null);
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
    refreshRagStatus(selectedTypeId);
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

  const formatIndexStatus = (chunkCount?: number, indexError?: string) => {
    if (indexError) return `Error al indexar: ${indexError}`;
    if (chunkCount != null && chunkCount > 0) return `Índice RAG generado: ${chunkCount} fragmentos.`;
    if (chunkCount === 0) return "Índice RAG vacío (no se extrajo texto del documento).";
    return null;
  };

  const handleUploadKnowledge = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !selectedTypeId) return;
    setIndexingKnowledge(true);
    setKnowledgeIndexStatus("Subiendo e indexando documento…");
    try {
      const capsRes = await fetch("/api/upload/capabilities");
      const caps = await capsRes.json().catch(() => ({}));
      const needsClientBlob = Array.from(files).some(
        (f) => f.size >= (caps.maxServerUploadBytes ?? MAX_VERCEL_SERVER_UPLOAD_BYTES)
      );
      const useClientBlob = caps.blobStorage === true && needsClientBlob;

      if (useClientBlob && caps.clientBlobUpload !== true) {
        throw new Error(
          "El archivo supera 4,5 MB y requiere subida directa a Vercel Blob, pero falta BLOB_READ_WRITE_TOKEN en el proyecto. En Vercel: Storage → Blob store → Connect to Project (o Settings → Environment Variables), luego redeploy."
        );
      }

      if (useClientBlob) {
        const uploaded: { name: string; url: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file?.name) continue;
          const filename = sanitizeFilename(file.name);
          const pathname = `knowledge/${selectedTypeId}/${filename}`;
          const blob = await upload(pathname, file, {
            access: "public",
            handleUploadUrl: "/api/upload/client",
            clientPayload: JSON.stringify({
              kind: "knowledge",
              evaluationTypeId: selectedTypeId,
            }),
            multipart: file.size > 5 * 1024 * 1024,
          });
          uploaded.push({ name: filename, url: blob.url });
        }
        if (uploaded.length === 0) {
          throw new Error("Ningún archivo válido para subir");
        }
        const res = await fetch("/api/upload/knowledge-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evaluationTypeId: selectedTypeId, uploaded }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Error al registrar documentos");
        }
        setConfig((c) => ({ ...c, knowledge_paths: data.knowledge_paths ?? c.knowledge_paths }));
        onTypesChange();
        setKnowledgeIndexStatus(formatIndexStatus(data.chunkCount, data.indexError));
        if (selectedTypeId) refreshRagStatus(selectedTypeId);
        return;
      }

      const form = new FormData();
      form.set("kind", "knowledge");
      form.set("evaluationTypeId", String(selectedTypeId));
      for (let i = 0; i < files.length; i++) form.append("files", files[i]);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Error al subir");
      }
      setConfig((c) => ({ ...c, knowledge_paths: data.knowledge_paths ?? c.knowledge_paths }));
      onTypesChange();
      setKnowledgeIndexStatus(formatIndexStatus(data.chunkCount, data.indexError));
      if (selectedTypeId) refreshRagStatus(selectedTypeId);
    } catch (err) {
      setKnowledgeIndexStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexingKnowledge(false);
      e.target.value = "";
    }
  };

  const handleRemoveKnowledge = async (index: number) => {
    if (!selectedTypeId) return;
    const item = config.knowledge_paths[index];
    const name = typeof item === "string" ? item : item?.name ?? "documento";
    if (!confirm(`¿Eliminar "${name}" de la base de conocimiento?`)) return;
    const newPaths = config.knowledge_paths.filter((_, i) => i !== index);
    setIndexingKnowledge(true);
    setKnowledgeIndexStatus("Eliminando e actualizando índice RAG…");
    try {
      const res = await fetch(`/api/config/${selectedTypeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledge_paths: newPaths }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al eliminar");
      setConfig((c) => ({ ...c, knowledge_paths: newPaths }));
      setKnowledgeIndexStatus(formatIndexStatus(data.chunkCount, data.indexError) ?? "Documento eliminado.");
      refreshRagStatus(selectedTypeId);
    } catch (err) {
      setKnowledgeIndexStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexingKnowledge(false);
    }
  };

  const handleReindexKnowledge = async () => {
    if (!selectedTypeId) return;
    setIndexingKnowledge(true);
    setKnowledgeIndexStatus("Regenerando índice RAG…");
    try {
      const res = await fetch(`/api/config/${selectedTypeId}/reindex`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al reindexar");
      setKnowledgeIndexStatus(formatIndexStatus(data.chunkCount) ?? "Índice actualizado.");
      refreshRagStatus(selectedTypeId);
    } catch (err) {
      setKnowledgeIndexStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexingKnowledge(false);
    }
  };

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

  const normSection = (s: string) => (s || "General").trim() || "General";
  const getSectionOrderAndMap = () => {
    const order: string[] = [];
    const bySection = new Map<string, ElementDef[]>();
    for (const el of config.elements) {
      const sec = normSection(el.section ?? "General");
      if (!bySection.has(sec)) {
        order.push(sec);
        bySection.set(sec, []);
      }
      bySection.get(sec)!.push(el);
    }
    return { sectionOrder: order, bySection };
  };
  const moveElementUp = (index: number) => {
    const sec = normSection(config.elements[index]?.section ?? "General");
    let swapWith = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (normSection(config.elements[i].section ?? "General") === sec) {
        swapWith = i;
        break;
      }
    }
    if (swapWith < 0) return;
    setConfig((c) => {
      const next = [...c.elements];
      [next[swapWith], next[index]] = [next[index], next[swapWith]];
      return { ...c, elements: next };
    });
  };
  const moveElementDown = (index: number) => {
    const sec = normSection(config.elements[index]?.section ?? "General");
    const nextSameSection = config.elements.findIndex((el, i) => i > index && normSection(el.section ?? "General") === sec);
    if (nextSameSection < 0) return;
    setConfig((c) => {
      const next = [...c.elements];
      [next[index], next[nextSameSection]] = [next[nextSameSection], next[index]];
      return { ...c, elements: next };
    });
  };
  const moveSectionUp = (sectionName: string) => {
    const { sectionOrder, bySection } = getSectionOrderAndMap();
    const idx = sectionOrder.indexOf(sectionName);
    if (idx <= 0) return;
    const newOrder = [...sectionOrder.slice(0, idx - 1), sectionName, sectionOrder[idx - 1], ...sectionOrder.slice(idx + 1)];
    const newElements = newOrder.flatMap((s) => bySection.get(s) ?? []);
    setConfig((c) => ({ ...c, elements: newElements }));
  };
  const moveSectionDown = (sectionName: string) => {
    const { sectionOrder, bySection } = getSectionOrderAndMap();
    const idx = sectionOrder.indexOf(sectionName);
    if (idx < 0 || idx >= sectionOrder.length - 1) return;
    const newOrder = [...sectionOrder.slice(0, idx), sectionOrder[idx + 1], sectionName, ...sectionOrder.slice(idx + 2)];
    const newElements = newOrder.flatMap((s) => bySection.get(s) ?? []);
    setConfig((c) => ({ ...c, elements: newElements }));
  };

  const knowledgeInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const sectionClass =
    "rounded-lg border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-600 dark:bg-gray-800/60";
  const sectionTitleClass = "text-sm font-semibold text-gray-800 dark:text-gray-200";
  const inputClass =
    "rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
  const btnPrimaryClass =
    "rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 disabled:opacity-50";
  const btnSecondaryClass =
    "rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700";
  const uploadZoneClass =
    "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white py-3 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700";
  const listPanelClass =
    "mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto rounded bg-gray-100 px-2 py-2 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300";
  const modalShellClass =
    "flex h-[90vh] w-full max-w-[95vw] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]";
  const modalSubShellClass =
    "flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-[#1e1e1e]";
  const iconBtnClass =
    "shrink-0 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={modalShellClass}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-600">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Configuración</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLlmConfigOpen(true)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Configurar LLM
            </button>
            {selectedTypeId && (
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={saving}
                className={btnPrimaryClass}
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
                className={`flex-1 ${inputClass}`}
              />
              <button
                type="button"
                onClick={handleCreateType}
                disabled={saving || !newTypeName.trim()}
                className={btnPrimaryClass}
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
              <div className="mt-3 flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => knowledgeInputRef.current?.click()}
                  disabled={indexingKnowledge}
                  className={uploadZoneClass}
                >
                  <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {indexingKnowledge ? "Indexando…" : "Subir documentos"}
                </button>
                {config.knowledge_paths.length > 0 && (
                  <button
                    type="button"
                    onClick={handleReindexKnowledge}
                    disabled={indexingKnowledge}
                    className={`shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700`}
                  >
                    Reindexar RAG
                  </button>
                )}
              </div>
              {ragStatus && (
                <p className="mt-2 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  Índice RAG:{" "}
                  {!ragStatus.knowledgeConfigured
                    ? "sin documentos configurados para este tipo de evaluación"
                    : ragStatus.hasIndex
                      ? `${ragStatus.chunkCount} fragmentos · ${formatBytes(ragStatus.chunksFileBytes)}${
                          ragStatus.indexedAt
                            ? ` · ${new Date(ragStatus.indexedAt).toLocaleString("es-CL")}`
                            : ""
                        }`
                      : "sin indexar (pulse Reindexar RAG tras subir documentos)"}
                </p>
              )}
              {knowledgeIndexStatus && (
                <p className={`mt-1 shrink-0 text-xs ${knowledgeIndexStatus.startsWith("Error") || knowledgeIndexStatus.includes("Error al indexar") ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                  {knowledgeIndexStatus}
                </p>
              )}
              {config.knowledge_paths.length > 0 && (
                <ul className={listPanelClass}>
                  <span className="font-medium">Archivos cargados:</span>
                  {config.knowledge_paths.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 pl-1">
                      <span className="min-w-0 truncate">{typeof p === "string" ? p : p.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveKnowledge(i)}
                        disabled={indexingKnowledge}
                        className="shrink-0 rounded px-1.5 py-0.5 text-gray-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                        title="Eliminar documento"
                        aria-label="Eliminar documento"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
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
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={sectionTitleClass}>3. Elementos a identificar</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Defina los elementos (título y descripción) que el LLM buscará en el Excel extraído para mostrar en &quot;Proyecto extraído&quot;. Agrupe por sección.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandSection("elements")}
                  className={iconBtnClass}
                  title="Ampliar en ventana nueva"
                  aria-label="Ampliar sección"
                >
                  <ExpandIcon />
                </button>
              </div>
              <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
                {(() => {
                  const bySection = new Map<string, { element: ElementDef; index: number }[]>();
                  config.elements.forEach((el, i) => {
                    const sec = (el.section ?? "General").trim() || "General";
                    if (!bySection.has(sec)) bySection.set(sec, []);
                    bySection.get(sec)!.push({ element: el, index: i });
                  });
                  const sectionEntries = Array.from(bySection.entries());
                  return sectionEntries.map(([secName, items], sectionIndex) => {
                    const colors = getSectionColor(secName);
                    const canSectionUp = sectionIndex > 0;
                    const canSectionDown = sectionIndex < sectionEntries.length - 1;
                    return (
                      <div
                        key={secName}
                        className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-2.5`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                            {secName}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveSectionUp(secName)}
                              disabled={!canSectionUp}
                              className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                              title="Subir sección"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSectionDown(secName)}
                              disabled={!canSectionDown}
                              className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                              title="Bajar sección"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
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
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map(({ element: el, index }, itemIdx) => {
                            const positionInSection = itemIdx + 1;
                            const canElUp = itemIdx > 0;
                            const canElDown = itemIdx < items.length - 1;
                            return (
                              <div
                                key={index}
                                className={`flex items-center gap-0.5 rounded border ${colors.card} px-2 py-1 text-sm shadow-sm`}
                              >
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-300 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-200" title={`Posición ${positionInSection} en la sección`}>
                                  {positionInSection}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => moveElementUp(index)}
                                  disabled={!canElUp}
                                  className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-300"
                                  title="Subir dentro de la sección"
                                >
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveElementDown(index)}
                                  disabled={!canElDown}
                                  className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-300"
                                  title="Bajar dentro de la sección"
                                >
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                                <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100" title={el.title}>
                                  {el.title || "(Sin título)"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openEditElementModal(index)}
                                  className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-300"
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
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <button
                type="button"
                onClick={openAddElementModal}
                className="mt-2 shrink-0 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Añadir elemento
              </button>
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={sectionTitleClass}>4. Rúbrica</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Texto de la rúbrica: criterios, niveles y ponderaciones. El LLM usará esto para evaluar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandSection("rubric")}
                  className={iconBtnClass}
                  title="Ampliar en ventana nueva"
                  aria-label="Ampliar sección"
                >
                  <ExpandIcon />
                </button>
              </div>
              <textarea
                value={config.rubric_prompt}
                onChange={(e) => setConfig((c) => ({ ...c, rubric_prompt: e.target.value }))}
                rows={6}
                className={`mt-3 min-h-0 flex-1 resize-none ${inputClass} font-mono`}
                placeholder="Describa la rúbrica: dimensiones, subcriterios, niveles (1-4), porcentajes..."
              />
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={sectionTitleClass}>5. Instrucciones</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Instrucciones y contexto general para que el LLM realice la evaluación según elementos, contenidos y rúbrica.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandSection("instructions")}
                  className={iconBtnClass}
                  title="Ampliar en ventana nueva"
                  aria-label="Ampliar sección"
                >
                  <ExpandIcon />
                </button>
              </div>
              <textarea
                value={config.instructions}
                onChange={(e) => setConfig((c) => ({ ...c, instructions: e.target.value }))}
                rows={6}
                className={`mt-3 min-h-0 flex-1 resize-none ${inputClass} font-mono`}
                placeholder="Ej.: Evalúa el proyecto usando el manual de Oslo y la rúbrica. Basa las notas en los elementos identificados..."
              />
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={sectionTitleClass}>6. Formato de informe</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Estructura, secciones y presentación del informe de evaluación.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandSection("reportFormat")}
                  className={iconBtnClass}
                  title="Ampliar en ventana nueva"
                  aria-label="Ampliar sección"
                >
                  <ExpandIcon />
                </button>
              </div>
              <textarea
                value={config.report_format}
                onChange={(e) => setConfig((c) => ({ ...c, report_format: e.target.value }))}
                rows={6}
                className={`mt-3 min-h-0 flex-1 resize-none ${inputClass} font-mono`}
                placeholder="Ej.: Incluye: 1. Resumen, 2. Notas por dimensión, 3. Justificación por criterio, 4. Recomendaciones..."
              />
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}
        </div>

        {expandSection === "elements" && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Elementos a identificar - ampliado" onClick={() => setExpandSection(null)}>
            <div className={modalSubShellClass} onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">3. Elementos a identificar</h2>
                <button type="button" onClick={() => setExpandSection(null)} className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Cerrar">✕</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-3 text-sm text-gray-800 dark:text-gray-200">
                  {(() => {
                    const bySection = new Map<string, ElementDef[]>();
                    config.elements.forEach((el) => {
                      const sec = (el.section ?? "General").trim() || "General";
                      if (!bySection.has(sec)) bySection.set(sec, []);
                      bySection.get(sec)!.push(el);
                    });
                    const sectionEntries = Array.from(bySection.entries());
                    return sectionEntries.length === 0 ? (
                      <p className="text-gray-600 dark:text-gray-400">No hay elementos definidos. Añádalos en la sección de configuración.</p>
                    ) : (
                      sectionEntries.map(([secName, items]) => {
                        const colors = getSectionColor(secName);
                        return (
                          <div key={secName} className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-3`}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">{secName}</div>
                            <ul className="space-y-2">
                              {items.map((el, i) => (
                                <li key={i} className={`rounded border ${colors.card} px-3 py-2`}>
                                  <span className="font-medium">{el.title || "(Sin título)"}</span>
                                  {el.description && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{el.description}</p>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
        {expandSection === "rubric" && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Rúbrica - ampliado" onClick={() => setExpandSection(null)}>
            <div className={modalSubShellClass} onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">4. Rúbrica</h2>
                <button type="button" onClick={() => setExpandSection(null)} className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Cerrar">✕</button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <textarea
                  value={config.rubric_prompt}
                  onChange={(e) => setConfig((c) => ({ ...c, rubric_prompt: e.target.value }))}
                  className={`h-full min-h-[300px] w-full resize-none font-mono ${inputClass}`}
                  placeholder="Describa la rúbrica: dimensiones, subcriterios, niveles (1-4), porcentajes..."
                />
              </div>
            </div>
          </div>
        )}
        {expandSection === "instructions" && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Instrucciones - ampliado" onClick={() => setExpandSection(null)}>
            <div className={modalSubShellClass} onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">5. Instrucciones</h2>
                <button type="button" onClick={() => setExpandSection(null)} className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Cerrar">✕</button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <textarea
                  value={config.instructions}
                  onChange={(e) => setConfig((c) => ({ ...c, instructions: e.target.value }))}
                  className={`h-full min-h-[300px] w-full resize-none font-mono ${inputClass}`}
                  placeholder="Ej.: Evalúa el proyecto usando el manual de Oslo y la rúbrica..."
                />
              </div>
            </div>
          </div>
        )}
        {expandSection === "reportFormat" && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Formato de informe - ampliado" onClick={() => setExpandSection(null)}>
            <div className={modalSubShellClass} onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">6. Formato de informe</h2>
                <button type="button" onClick={() => setExpandSection(null)} className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Cerrar">✕</button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <textarea
                  value={config.report_format}
                  onChange={(e) => setConfig((c) => ({ ...c, report_format: e.target.value }))}
                  className={`h-full min-h-[300px] w-full resize-none font-mono ${inputClass}`}
                  placeholder="Ej.: Incluye: 1. Resumen, 2. Notas por dimensión..."
                />
              </div>
            </div>
          </div>
        )}

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
                    className={`w-full ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Descripción</label>
                  <textarea
                    value={elementForm.description}
                    onChange={(e) => setElementForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Ej. nombre o título principal, suele ser la letra más grande"
                    rows={2}
                    className={`w-full resize-none ${inputClass}`}
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
                          className={`w-full ${inputClass}`}
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
                            className={`mt-2 w-full ${inputClass}`}
                            autoFocus
                          />
                        )}
                        {existingSections.length > 0 && (
                          <div className="mt-2">
                            <span className="text-xs text-gray-600 dark:text-gray-400">Eliminar sección de la lista: </span>
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
                  className={btnPrimaryClass}
                >
                  {editingElementIndex !== null ? "Guardar" : "Añadir"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <LlmConfigModal isOpen={llmConfigOpen} onClose={() => setLlmConfigOpen(false)} />
    </div>
  );
}
