"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { upload, uploadPresigned } from "@vercel/blob/client";
import { ExpandIcon } from "@/components/FullscreenOverlay";
import LlmConfigModal from "@/components/LlmConfigModal";
import AgentConfigModal from "@/components/AgentConfigModal";
import BulkConfigModal from "@/components/BulkConfigModal";
import {
  RagConfigFields,
  ExtractConfigFields,
  ElementStrategyFields,
} from "@/components/config/TypeSettingsFields";
import { EvaluationConfigFields } from "@/components/config/EvaluationConfigFields";
import {
  defaultEvaluationTypeSettings,
  type ElementDefConfig,
  type RagConfig,
  type ExtractConfig,
  type ElementExtractStrategy,
} from "@/lib/evaluation-type-settings";
import {
  defaultEvaluationConfig,
  mergeEvaluationConfig,
  type EvaluationConfig,
} from "@/lib/evaluation-config";
import RubricEditor from "@/components/rubric/RubricEditor";
import ReportFormatEditor from "@/components/report-format/ReportFormatEditor";
import {
  defaultRubricConfigPonderaciones,
  mergeRubricConfig,
  type RubricConfig,
} from "@/lib/rubric-config";
import {
  defaultReportFormatPonderaciones,
  mergeReportFormatConfig,
  syncReportFormatWithRubric,
  type ReportFormatConfig,
} from "@/lib/report-format-config";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import { MAX_VERCEL_SERVER_UPLOAD_BYTES } from "@/lib/upload-limits";

type EvaluationType = { id: number; name: string };
type KnowledgeItem = string | { name: string; url: string };
type ElementDef = ElementDefConfig;
type Config = {
  knowledge_paths: KnowledgeItem[];
  elements: ElementDef[];
  report_format: string;
  rubric_prompt: string;
  rubric_config: RubricConfig;
  report_format_config: ReportFormatConfig;
  evaluation_config: EvaluationConfig;
  rag_config: RagConfig;
  extract_config: ExtractConfig;
};

const defaultRubric = defaultRubricConfigPonderaciones();
const defaultTypeSettings = defaultEvaluationTypeSettings();
const defaultConfig: Config = {
  knowledge_paths: [],
  elements: [],
  report_format: "",
  rubric_prompt: "",
  rubric_config: defaultRubric,
  report_format_config: defaultReportFormatPonderaciones(defaultRubric),
  evaluation_config: defaultEvaluationConfig(),
  rag_config: defaultTypeSettings.rag,
  extract_config: defaultTypeSettings.extract,
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
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [bulkConfigOpen, setBulkConfigOpen] = useState(false);
  const [ragStatus, setRagStatus] = useState<{
    hasIndex: boolean;
    chunkCount: number;
    indexedAt: string | null;
    chunksFileBytes: number;
    knowledgeConfigured: boolean;
  } | null>(null);
  const [blobCatalog, setBlobCatalog] = useState<
    { name: string; pathname: string; url: string; size: number; uploadedAt: string }[]
  >([]);
  const [blobCatalogLoading, setBlobCatalogLoading] = useState(false);
  const [selectedBlobUrls, setSelectedBlobUrls] = useState<Set<string>>(new Set());
  const [blobStorageEnabled, setBlobStorageEnabled] = useState(false);
  const ragStatusCacheRef = useRef<
    Map<
      number,
      {
        hasIndex: boolean;
        chunkCount: number;
        indexedAt: string | null;
        chunksFileBytes: number;
        knowledgeConfigured: boolean;
      }
    >
  >(new Map());
  const blobCatalogLoadedRef = useRef(false);
  const selectedTypeIdRef = useRef<number | null>(null);

  const loadBlobCatalog = useCallback(() => {
    setBlobCatalogLoading(true);
    fetch("/api/upload/blob-list")
      .then((r) => r.json())
      .then((data) => {
        setBlobStorageEnabled(!!data.blobStorage);
        setBlobCatalog(Array.isArray(data.blobs) ? data.blobs : []);
      })
      .catch(() => {
        setBlobCatalog([]);
        setBlobStorageEnabled(false);
      })
      .finally(() => setBlobCatalogLoading(false));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      blobCatalogLoadedRef.current = false;
      return;
    }
    fetch("/api/upload/capabilities")
      .then((r) => r.json())
      .then((data) => setBlobStorageEnabled(!!data?.blobStorage))
      .catch(() => setBlobStorageEnabled(false));
    if (!blobCatalogLoadedRef.current) {
      blobCatalogLoadedRef.current = true;
      loadBlobCatalog();
    }
  }, [isOpen, loadBlobCatalog]);

  const refreshRagStatus = useCallback((typeId: number, options?: { force?: boolean }) => {
    const cached = ragStatusCacheRef.current.get(typeId);
    if (cached && !options?.force) {
      setRagStatus(cached);
      return;
    }
    if (options?.force) ragStatusCacheRef.current.delete(typeId);
    fetch(`/api/config/${typeId}/rag-status`)
      .then((r) => r.json())
      .then((data) => {
        if (typeof data?.chunkCount !== "number") return;
        const status = {
          hasIndex: !!data.hasIndex,
          chunkCount: data.chunkCount,
          indexedAt: data.indexedAt ?? null,
          chunksFileBytes: data.chunksFileBytes ?? 0,
          knowledgeConfigured: !!data.knowledgeConfigured,
        };
        ragStatusCacheRef.current.set(typeId, status);
        if (selectedTypeIdRef.current === typeId) setRagStatus(status);
      })
      .catch(() => {
        if (selectedTypeIdRef.current === typeId) setRagStatus(null);
      });
  }, []);

  const linkedKnowledge = useCallback(() => {
    const urls = new Set<string>();
    const names = new Set<string>();
    for (const p of config.knowledge_paths) {
      if (typeof p === "object" && p?.url) urls.add(p.url);
      const name = typeof p === "string" ? p : p?.name;
      if (name) names.add(name.toLowerCase());
    }
    return { urls, names };
  }, [config.knowledge_paths]);

  const isBlobLinkedToEvaluation = useCallback(
    (blob: { url: string; name: string }) => {
      const { urls, names } = linkedKnowledge();
      return urls.has(blob.url) || names.has(blob.name.toLowerCase());
    },
    [linkedKnowledge]
  );
  const [showElementModal, setShowElementModal] = useState(false);
  const [editingElementIndex, setEditingElementIndex] = useState<number | null>(null);
  const [elementForm, setElementForm] = useState<{
    title: string;
    description: string;
    section: string;
    extractStrategy?: ElementExtractStrategy;
  }>({ title: "", description: "", section: "General" });
  type ExpandSectionId = "knowledge" | "elements" | "rubric" | "evaluation" | "reportFormat";
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
    if (!isOpen || !selectedTypeId) {
      if (!selectedTypeId) {
        setConfig(defaultConfig);
        setRagStatus(null);
        setKnowledgeIndexStatus(null);
      }
      return;
    }
    selectedTypeIdRef.current = selectedTypeId;
    const cached = ragStatusCacheRef.current.get(selectedTypeId);
    setRagStatus(cached ?? null);
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
        const defaults = defaultEvaluationTypeSettings();
        const typeName = types.find((t) => t.id === selectedTypeId)?.name;
        const rubric_config = mergeRubricConfig(data.rubric_config, typeName);
        const report_format_config = mergeReportFormatConfig(data.report_format_config, rubric_config);
        setConfig({
          knowledge_paths: Array.isArray(data.knowledge_paths) ? data.knowledge_paths : [],
          elements: elements.map((e: ElementDef) => ({
            title: String(e.title ?? ""),
            description: String(e.description ?? ""),
            section: typeof e.section === "string" ? e.section : "General",
            extractStrategy: e.extractStrategy,
          })),
          report_format: data.report_format ?? "",
          rubric_prompt: data.rubric_prompt ?? "",
          rubric_config,
          report_format_config,
          evaluation_config: mergeEvaluationConfig(
            {
              evaluation_config: data.evaluation_config,
              pipeline_config: data.pipeline_config,
              report_format_config,
              rag_config: data.rag_config,
            },
            typeName
          ),
          rag_config: data.rag_config ?? defaults.rag,
          extract_config: data.extract_config ?? defaults.extract,
        });
      })
      .catch(() => setConfig(defaultConfig))
      .finally(() => setLoading(false));
    refreshRagStatus(selectedTypeId);
  }, [isOpen, selectedTypeId, refreshRagStatus, types]);

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
    const password = window.prompt("Contraseña para eliminar:");
    if (password === null) return;
    const res = await fetch(`/api/evaluation-types/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      onTypesChange();
      if (selectedTypeId === id) setSelectedTypeId(types[0]?.id ?? null);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(typeof err?.error === "string" ? err.error : "No se pudo eliminar el tipo.");
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
          report_format: config.report_format,
          rubric_prompt: config.rubric_prompt,
          rubric_config: config.rubric_config,
          report_format_config: config.report_format_config,
          evaluation_config: config.evaluation_config,
          rag_config: config.rag_config,
          extract_config: config.extract_config,
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
      const useClientBlob =
        caps.blobStorage === true &&
        needsClientBlob &&
        (caps.clientBlobUpload === true || caps.presignedClientUpload === true);

      if (needsClientBlob && caps.blobStorage && !useClientBlob) {
        throw new Error(
          "El archivo supera 4,5 MB. Conecta Vercel Blob al proyecto (BLOB_STORE_ID + BLOB_WEBHOOK_PUBLIC_KEY) y redeploy."
        );
      }

      if (useClientBlob) {
        const usePresigned = caps.presignedClientUpload === true;
        const uploaded: { name: string; url: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file?.name) continue;
          const filename = sanitizeFilename(file.name);
          const pathname = `knowledge/${selectedTypeId}/${filename}`;
          const uploadOpts = {
            access: "public" as const,
            handleUploadUrl: "/api/upload/client",
            clientPayload: JSON.stringify({
              kind: "knowledge",
              evaluationTypeId: selectedTypeId,
            }),
            multipart: file.size > 5 * 1024 * 1024,
          };
          const blob = usePresigned
            ? await uploadPresigned(pathname, file, uploadOpts)
            : await upload(pathname, file, uploadOpts);
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
        if (selectedTypeId) refreshRagStatus(selectedTypeId, { force: true });
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
      if (selectedTypeId) refreshRagStatus(selectedTypeId, { force: true });
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
      refreshRagStatus(selectedTypeId, { force: true });
    } catch (err) {
      setKnowledgeIndexStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexingKnowledge(false);
    }
  };

  const handleLinkBlobDocuments = async () => {
    if (!selectedTypeId || selectedBlobUrls.size === 0) return;
    const blobs = blobCatalog
      .filter((b) => selectedBlobUrls.has(b.url))
      .map((b) => ({ name: b.name, url: b.url }));
    if (blobs.length === 0) return;
    setIndexingKnowledge(true);
    setKnowledgeIndexStatus("Vinculando documentos del almacenamiento…");
    try {
      const res = await fetch("/api/upload/knowledge-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluationTypeId: selectedTypeId, blobs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al vincular documentos");
      setConfig((c) => ({ ...c, knowledge_paths: data.knowledge_paths ?? c.knowledge_paths }));
      onTypesChange();
      setSelectedBlobUrls(new Set());
      setKnowledgeIndexStatus(formatIndexStatus(data.chunkCount, data.indexError));
      refreshRagStatus(selectedTypeId, { force: true });
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
      refreshRagStatus(selectedTypeId, { force: true });
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
      extractStrategy: el.extractStrategy,
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
      extractStrategy: elementForm.extractStrategy,
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
  const modalShellClass =
    "flex h-[90vh] w-full max-w-[95vw] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]";
  const modalSubShellClass =
    "flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-[#1e1e1e]";
  const iconBtnClass =
    "shrink-0 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200";

  const knowledgeBody = (
    <>
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
            className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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
        <p
          className={`mt-1 shrink-0 text-xs ${
            knowledgeIndexStatus.startsWith("Error") || knowledgeIndexStatus.includes("Error al indexar")
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {knowledgeIndexStatus}
        </p>
      )}
      <RagConfigFields
        rag={config.rag_config}
        onChange={(rag_config) => setConfig((c) => ({ ...c, rag_config }))}
      />
      {!blobStorageEnabled && (
        <p className="mt-2 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Falta autenticación de servidor para Blob. Añade{" "}
          <code className="text-[11px]">BLOB_READ_WRITE_TOKEN</code> en{" "}
          <code className="text-[11px]">.env.local</code> (desde Vercel → Storage → tu Blob store → token), o ejecuta{" "}
          <code className="text-[11px]">npx vercel env pull .env.local</code> para obtener{" "}
          <code className="text-[11px]">VERCEL_OIDC_TOKEN</code>. Luego reinicia{" "}
          <code className="text-[11px]">npm run dev</code>.
        </p>
      )}
      <div className="mt-3 flex min-h-0 flex-1 gap-2 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-600 dark:bg-gray-900/40">
          <span className="mb-2 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-400">
            Archivos cargados
          </span>
          {config.knowledge_paths.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">Ningún documento en esta evaluación.</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-xs">
              {config.knowledge_paths.map((p, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded bg-emerald-50/80 px-2 py-1 dark:bg-emerald-950/30"
                >
                  <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-200">
                    {typeof p === "string" ? p : p.name}
                  </span>
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
        </div>

        {blobStorageEnabled && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-600 dark:bg-gray-900/40">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Disponibles en Blob</span>
              <button
                type="button"
                onClick={loadBlobCatalog}
                disabled={blobCatalogLoading}
                className="text-xs text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                {blobCatalogLoading ? "Cargando…" : "Actualizar"}
              </button>
            </div>
            {blobCatalog.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {blobCatalogLoading ? "Buscando archivos…" : "No hay documentos en el almacenamiento."}
              </p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-xs">
                {blobCatalog.map((b) => {
                  const linked = isBlobLinkedToEvaluation(b);
                  const checked = selectedBlobUrls.has(b.url);
                  return (
                    <li
                      key={b.url}
                      className={`flex items-start gap-2 rounded px-1 py-0.5 ${
                        linked
                          ? "bg-emerald-100/70 dark:bg-emerald-900/40"
                          : "hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        disabled={linked || indexingKnowledge}
                        checked={linked || checked}
                        onChange={(e) => {
                          setSelectedBlobUrls((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(b.url);
                            else next.delete(b.url);
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`block truncate font-medium ${linked ? "text-emerald-800 dark:text-emerald-200" : ""}`}
                          >
                            {b.name}
                          </span>
                          {linked && (
                            <span className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-emerald-700">
                              Cargado
                            </span>
                          )}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">{formatBytes(b.size)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {selectedBlobUrls.size > 0 && (
              <button
                type="button"
                onClick={() => void handleLinkBlobDocuments()}
                disabled={indexingKnowledge}
                className="mt-2 w-full shrink-0 rounded-lg border border-emerald-600 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                Añadir {selectedBlobUrls.size} seleccionado(s) a knowledge
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={modalShellClass}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={knowledgeInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.json"
          className="sr-only"
          onChange={handleUploadKnowledge}
        />
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-600">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Configuración</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkConfigOpen(true)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Configurar masivo
            </button>
            <button
              type="button"
              onClick={() => setAgentConfigOpen(true)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Configurar agente
            </button>
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
            <div className="flex shrink-0 items-baseline justify-between gap-2">
              <h3 className={sectionTitleClass}>1. Tipo de evaluación</h3>
              {selectedTypeId && (
                <span className="truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {types.find((t) => t.id === selectedTypeId)?.name}
                </span>
              )}
            </div>
            <div className="mt-2 flex shrink-0 gap-1.5">
              <input
                type="text"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="Nuevo tipo (IGIP, TRL…)"
                className={`min-w-0 flex-1 ${inputClass} py-1.5 text-xs`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateType();
                }}
              />
              <button
                type="button"
                onClick={handleCreateType}
                disabled={saving || !newTypeName.trim()}
                className={`shrink-0 px-3 py-1.5 text-xs ${btnPrimaryClass}`}
              >
                Crear
              </button>
            </div>
            {types.length > 0 && (
              <div
                className="mt-2 flex shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 pb-2 dark:border-gray-600"
                role="tablist"
                aria-label="Tipos de evaluación"
              >
                {types.map((t) => {
                  const selected = selectedTypeId === t.id;
                  return (
                    <span
                      key={t.id}
                      className={`inline-flex items-center overflow-hidden rounded-md border text-xs ${
                        selected
                          ? "border-gray-400 bg-gray-200 dark:border-gray-500 dark:bg-gray-600"
                          : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
                      }`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setSelectedTypeId(t.id)}
                        className={`px-2.5 py-1 font-medium ${
                          selected ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteType(t.id)}
                        className="border-l border-gray-300 px-1.5 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:border-gray-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        title={`Eliminar ${t.name}`}
                        aria-label={`Eliminar ${t.name}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {selectedTypeId ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Los parámetros de evaluación están en la sección 5.
                </p>
              ) : types.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Cree un tipo para configurar el pipeline de evaluación.
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">Seleccione un tipo arriba.</p>
              )}
            </div>
          </section>

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={sectionTitleClass}>2. Documentos de referencia (Knowledge)</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Archivos que el evaluador usará como base de conocimiento (PDF, Word, Excel, texto, etc.).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandSection("knowledge")}
                  className={iconBtnClass}
                  title="Ampliar en ventana nueva"
                  aria-label="Ampliar sección"
                >
                  <ExpandIcon />
                </button>
              </div>
              {expandSection !== "knowledge" && knowledgeBody}
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
              <div className="mt-3 shrink-0">
                <ExtractConfigFields
                  extract={config.extract_config}
                  onChange={(extract_config) => setConfig((c) => ({ ...c, extract_config }))}
                />
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
                    Criterios por ponderaciones o niveles. La escala de notas se configura aquí (§4).
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
              <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                <RubricEditor
                  value={config.rubric_config}
                  onChange={(rubric_config) =>
                    setConfig((c) => ({
                      ...c,
                      rubric_config,
                      report_format_config: syncReportFormatWithRubric(
                        c.report_format_config,
                        rubric_config
                      ),
                    }))
                  }
                />
              </div>
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}

          {selectedTypeId ? (
            <section className={`${sectionClass} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={sectionTitleClass}>5. Evaluación</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Parámetros del proceso de evaluación: metodología programada, límites por fase y
                    opciones de RAG.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandSection("evaluation")}
                  className={iconBtnClass}
                  title="Ampliar en ventana nueva"
                  aria-label="Ampliar sección"
                >
                  <ExpandIcon />
                </button>
              </div>
              <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                <EvaluationConfigFields
                  evaluation={config.evaluation_config}
                  rubric={config.rubric_config}
                  onChange={(evaluation_config) => setConfig((c) => ({ ...c, evaluation_config }))}
                />
              </div>
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
                    Estructura obligatoria según la rúbrica; secciones extra opcionales al inicio o antes del cierre.
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
              <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                <ReportFormatEditor
                  value={config.report_format_config}
                  rubric={config.rubric_config}
                  onChange={(report_format_config) =>
                    setConfig((c) => ({ ...c, report_format_config }))
                  }
                />
              </div>
            </section>
          ) : (
            <section className={`${sectionClass} flex min-h-0 flex-col items-center justify-center overflow-hidden`} />
          )}
        </div>

        {expandSection === "knowledge" && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Documentos de referencia - ampliado"
            onClick={() => setExpandSection(null)}
          >
            <div
              className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-[#1e1e1e]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  2. Documentos de referencia (Knowledge)
                </h2>
                <button
                  type="button"
                  onClick={() => setExpandSection(null)}
                  className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">{knowledgeBody}</div>
            </div>
          </div>
        )}
        {expandSection === "elements" && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Elementos a identificar - ampliado" onClick={() => setExpandSection(null)}>
            <div className={modalSubShellClass} onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">3. Elementos a identificar</h2>
                <button type="button" onClick={() => setExpandSection(null)} className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Cerrar">✕</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ExtractConfigFields
                  extract={config.extract_config}
                  onChange={(extract_config) => setConfig((c) => ({ ...c, extract_config }))}
                />
                <div className="mt-4 space-y-3 text-sm text-gray-800 dark:text-gray-200">
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                <RubricEditor
                  value={config.rubric_config}
                  onChange={(rubric_config) =>
                    setConfig((c) => ({
                      ...c,
                      rubric_config,
                      report_format_config: syncReportFormatWithRubric(
                        c.report_format_config,
                        rubric_config
                      ),
                    }))
                  }
                />
              </div>
            </div>
          </div>
        )}
        {expandSection === "evaluation" && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Evaluación - ampliado" onClick={() => setExpandSection(null)}>
            <div className={modalSubShellClass} onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">5. Evaluación</h2>
                <button type="button" onClick={() => setExpandSection(null)} className="rounded p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Cerrar">✕</button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <EvaluationConfigFields
                  evaluation={config.evaluation_config}
                  rubric={config.rubric_config}
                  onChange={(evaluation_config) => setConfig((c) => ({ ...c, evaluation_config }))}
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                <ReportFormatEditor
                  value={config.report_format_config}
                  rubric={config.rubric_config}
                  onChange={(report_format_config) =>
                    setConfig((c) => ({ ...c, report_format_config }))
                  }
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
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-600 dark:bg-[#252526]"
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
                <ElementStrategyFields
                  strategy={elementForm.extractStrategy}
                  onChange={(extractStrategy) => setElementForm((f) => ({ ...f, extractStrategy }))}
                />
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
      <AgentConfigModal isOpen={agentConfigOpen} onClose={() => setAgentConfigOpen(false)} />
      <BulkConfigModal isOpen={bulkConfigOpen} onClose={() => setBulkConfigOpen(false)} />
      <LlmConfigModal isOpen={llmConfigOpen} onClose={() => setLlmConfigOpen(false)} />
    </div>
  );
}
