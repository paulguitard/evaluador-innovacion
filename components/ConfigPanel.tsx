"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { upload, uploadPresigned } from "@vercel/blob/client";
import LlmConfigModal from "@/components/LlmConfigModal";
import AgentConfigModal from "@/components/AgentConfigModal";
import BulkConfigModal from "@/components/BulkConfigModal";
import AgentToolsViewerModal from "@/components/AgentToolsViewerModal";
import SystemPromptViewerModal from "@/components/SystemPromptViewerModal";
import { ElementStrategyFields } from "@/components/config/TypeSettingsFields";
import { EvaluationFlowMap } from "@/components/config/flow/EvaluationFlowMap";
import { IgipFlowConfigModal } from "@/components/config/flow/IgipFlowConfigModal";
import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";
import { isIgip, isImet } from "@/lib/eval-types/constants";
import {
  defaultEvaluationTypeSettings,
  mergeEvaluationTypeSettings,
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
import {
  defaultRubricConfigPonderaciones,
  mergeRubricConfig,
  type RubricConfig,
} from "@/lib/rubric-config";
import {
  defaultReportFormatPonderaciones,
  mergeReportFormatConfig,
  syncReportFormatWithRubric,
  expandReportSections,
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

function findTypeByKey(types: EvaluationType[], key: "IGIP" | "IMET") {
  return types.find((t) => t.name.toUpperCase().includes(key)) ?? null;
}

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [indexingKnowledge, setIndexingKnowledge] = useState(false);
  const [knowledgeIndexStatus, setKnowledgeIndexStatus] = useState<string | null>(null);
  const [llmConfigOpen, setLlmConfigOpen] = useState(false);
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [bulkConfigOpen, setBulkConfigOpen] = useState(false);
  const [agentToolsViewerOpen, setAgentToolsViewerOpen] = useState(false);
  const [systemPromptsViewerOpen, setSystemPromptsViewerOpen] = useState(false);
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
  const [flowModal, setFlowModal] = useState<FlowConfigActionId | null>(null);
  const [flowPromptRefreshKey, setFlowPromptRefreshKey] = useState(0);
  const [showElementModal, setShowElementModal] = useState(false);
  const [editingElementIndex, setEditingElementIndex] = useState<number | null>(null);
  const [elementForm, setElementForm] = useState<{
    title: string;
    description: string;
    section: string;
    extractStrategy?: ElementExtractStrategy;
  }>({ title: "", description: "", section: "General" });

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
        const typeName = types.find((t) => t.id === selectedTypeId)?.name;
        const typeSettings = mergeEvaluationTypeSettings(
          {
            rag_config: data.rag_config,
            extract_config: data.extract_config,
            pipeline_config: data.pipeline_config,
          },
          typeName
        );
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
              rubric_config,
            },
            typeName
          ),
          rag_config: typeSettings.rag,
          extract_config: typeSettings.extract,
        });
      })
      .catch(() => setConfig(defaultConfig))
      .finally(() => setLoading(false));
    refreshRagStatus(selectedTypeId);
  }, [isOpen, selectedTypeId, refreshRagStatus, types]);

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
      const savedTypeName = types.find((t) => t.id === selectedTypeId)?.name;
      if (savedTypeName && (isIgip(savedTypeName) || isImet(savedTypeName))) {
        setFlowPromptRefreshKey((k) => k + 1);
      }
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

  const existingSections = Array.from(
    new Set(config.elements.map((e) => (e.section ?? "General").trim()).filter(Boolean))
  ).sort();

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
  const inputClass =
    "rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
  const btnPrimaryClass =
    "rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 disabled:opacity-50";
  const modalShellClass =
    "flex h-[90vh] w-full max-w-[95vw] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]";

  const knowledgeDocsProps = {
    indexingKnowledge,
    knowledgeIndexStatus,
    ragStatus,
    blobStorageEnabled,
    blobCatalog,
    blobCatalogLoading,
    selectedBlobUrls,
    onUploadClick: () => knowledgeInputRef.current?.click(),
    onReindex: () => void handleReindexKnowledge(),
    onRemoveKnowledge: (index: number) => void handleRemoveKnowledge(index),
    onLoadBlobCatalog: loadBlobCatalog,
    onToggleBlobSelection: (url: string, checked: boolean) => {
      setSelectedBlobUrls((prev) => {
        const next = new Set(prev);
        if (checked) next.add(url);
        else next.delete(url);
        return next;
      });
    },
    onLinkBlobDocuments: () => void handleLinkBlobDocuments(),
    isBlobLinked: isBlobLinkedToEvaluation,
  };

  const elementsListProps = {
    onAddElement: openAddElementModal,
    onEditElement: openEditElementModal,
    onRemoveElement: removeElement,
    onMoveElementUp: moveElementUp,
    onMoveElementDown: moveElementDown,
    onMoveSectionUp: moveSectionUp,
    onMoveSectionDown: moveSectionDown,
    onRemoveSection: removeSection,
  };

  const selectedTypeName = types.find((t) => t.id === selectedTypeId)?.name;
  const igipType = findTypeByKey(types, "IGIP");
  const imetType = findTypeByKey(types, "IMET");
  const isImetSelected = selectedTypeName != null && isImet(selectedTypeName);
  const flowKind = isImetSelected ? "IMET" : "IGIP";

  const dimensionCount =
    config.rubric_config.type === "ponderaciones"
      ? config.rubric_config.dimensions.length
      : 0;
  const subdimensionCount =
    config.rubric_config.type === "ponderaciones"
      ? config.rubric_config.dimensions.reduce((n, d) => n + d.subdimensions.length, 0)
      : 0;
  const variableCount =
    config.rubric_config.type === "niveles" ? config.rubric_config.variables.length : 0;
  const levelCount =
    config.rubric_config.type === "niveles" ? config.rubric_config.levels.length : 0;

  const flowStepStatuses = isImetSelected
    ? {
        extract: `${config.elements.length} elemento${config.elements.length === 1 ? "" : "s"}`,
        knowledge: ragStatus?.hasIndex
          ? `${ragStatus.chunkCount} fragmentos`
          : `${config.knowledge_paths.length} doc${config.knowledge_paths.length === 1 ? "" : "s"}`,
        rubric: `${variableCount} var · ${levelCount} niveles`,
        evaluate:
          variableCount > 0
            ? `${variableCount} variable${variableCount === 1 ? "" : "s"}`
            : "Nivel global",
        report: `${expandReportSections(config.rubric_config, config.report_format_config).length} secciones`,
        level: "Automático",
      }
    : {
        extract: `${config.elements.length} elemento${config.elements.length === 1 ? "" : "s"}`,
        knowledge: ragStatus?.hasIndex
          ? `${ragStatus.chunkCount} fragmentos`
          : `${config.knowledge_paths.length} doc${config.knowledge_paths.length === 1 ? "" : "s"}`,
        rubric: `${dimensionCount} dim · ${subdimensionCount} subdim`,
        evaluate: `${subdimensionCount} subdimensión${subdimensionCount === 1 ? "" : "es"}`,
        report: `${expandReportSections(config.rubric_config, config.report_format_config).length} secciones`,
        scores: "Automático",
      };

  const selectEvalType = (id: number) => {
    setFlowModal(null);
    setSelectedTypeId(id);
    onSelectType(id);
  };

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
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Configuración</h2>
            <div className="flex items-center gap-2" role="tablist" aria-label="Tipo de evaluación">
              {(["IGIP", "IMET"] as const).map((key) => {
                const t = key === "IGIP" ? igipType : imetType;
                const selected = t != null && selectedTypeId === t.id;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    disabled={!t}
                    onClick={() => t && selectEvalType(t.id)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? "border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-600"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAgentToolsViewerOpen(true)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Ver herramientas
            </button>
            <button
              type="button"
              onClick={() => setSystemPromptsViewerOpen(true)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Ver system prompts
            </button>
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

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-6">
          <section className={`${sectionClass} flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`}>
            {!selectedTypeId ? (
              <div className="flex flex-1 items-center justify-center p-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Seleccione IGIP o IMET para configurar.
                </p>
              </div>
            ) : loading ? (
              <div className="flex flex-1 items-center justify-center p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Cargando configuración…</p>
              </div>
            ) : (
              <EvaluationFlowMap
                evaluationTypeId={selectedTypeId}
                flowKind={flowKind}
                onOpenConfig={setFlowModal}
                stepStatuses={flowStepStatuses}
                refreshKey={flowPromptRefreshKey}
              />
            )}
          </section>
        </div>

        <IgipFlowConfigModal
          actionId={flowModal}
          onClose={() => setFlowModal(null)}
          evaluationTypeName={selectedTypeName}
          config={config}
          onConfigChange={{
            setExtract: (extract_config) => setConfig((c) => ({ ...c, extract_config })),
            setRag: (rag_config) => setConfig((c) => ({ ...c, rag_config })),
            setRubric: (rubric_config) =>
              setConfig((c) => ({
                ...c,
                rubric_config,
                report_format_config: syncReportFormatWithRubric(c.report_format_config, rubric_config),
              })),
            setEvaluation: (evaluation_config) => setConfig((c) => ({ ...c, evaluation_config })),
            setReportFormat: (report_format_config) => setConfig((c) => ({ ...c, report_format_config })),
          }}
          knowledgeDocsProps={knowledgeDocsProps}
          elementsListProps={elementsListProps}
        />

        {showElementModal && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
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
      <AgentToolsViewerModal
        isOpen={agentToolsViewerOpen}
        onClose={() => setAgentToolsViewerOpen(false)}
      />
      <SystemPromptViewerModal
        isOpen={systemPromptsViewerOpen}
        onClose={() => setSystemPromptsViewerOpen(false)}
      />
    </div>
  );
}
