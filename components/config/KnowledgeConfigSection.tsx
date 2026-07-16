"use client";

import type { RefObject } from "react";
import type { RagConfig } from "@/lib/evaluation-type-settings";
import { RagConfigFields } from "@/components/config/TypeSettingsFields";
import { formatBytes } from "./config-panel-utils";

type KnowledgeItem = string | { name: string; url: string };

export function KnowledgeDocsSection({
  knowledgePaths,
  indexingKnowledge,
  knowledgeIndexStatus,
  ragStatus,
  blobStorageEnabled,
  blobCatalog,
  blobCatalogLoading,
  selectedBlobUrls,
  onUploadClick,
  onReindex,
  onRemoveKnowledge,
  onLoadBlobCatalog,
  onToggleBlobSelection,
  onLinkBlobDocuments,
  isBlobLinked,
}: {
  knowledgePaths: KnowledgeItem[];
  indexingKnowledge: boolean;
  knowledgeIndexStatus: string | null;
  ragStatus: {
    hasIndex: boolean;
    chunkCount: number;
    indexedAt: string | null;
    chunksFileBytes: number;
    knowledgeConfigured: boolean;
  } | null;
  blobStorageEnabled: boolean;
  blobCatalog: { name: string; pathname: string; url: string; size: number; uploadedAt: string }[];
  blobCatalogLoading: boolean;
  selectedBlobUrls: Set<string>;
  onUploadClick: () => void;
  onReindex: () => void;
  onRemoveKnowledge: (index: number) => void;
  onLoadBlobCatalog: () => void;
  onToggleBlobSelection: (url: string, checked: boolean) => void;
  onLinkBlobDocuments: () => void;
  isBlobLinked: (blob: { url: string; name: string }) => boolean;
}) {
  const uploadZoneClass =
    "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white py-3 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700";

  return (
    <div className="space-y-3 pb-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUploadClick}
          disabled={indexingKnowledge}
          className={uploadZoneClass}
        >
          <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {indexingKnowledge ? "Indexando…" : "Subir documentos"}
        </button>
        {knowledgePaths.length > 0 && (
          <button
            type="button"
            onClick={onReindex}
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
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col rounded-lg border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-600 dark:bg-gray-900/40">
          <span className="mb-2 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-400">Archivos cargados</span>
          {knowledgePaths.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">Ningún documento en esta evaluación.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto text-xs sm:max-h-none">
              {knowledgePaths.map((p, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded bg-emerald-50/80 px-2 py-1 dark:bg-emerald-950/30"
                >
                  <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-200">
                    {typeof p === "string" ? p : p.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveKnowledge(i)}
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
          <div className="flex flex-col rounded-lg border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-600 dark:bg-gray-900/40">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Disponibles en Blob</span>
              <button
                type="button"
                onClick={onLoadBlobCatalog}
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
              <ul className="max-h-56 space-y-1 overflow-y-auto text-xs sm:max-h-none">
                {blobCatalog.map((b) => {
                  const linked = isBlobLinked(b);
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
                        onChange={(e) => onToggleBlobSelection(b.url, e.target.checked)}
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
                onClick={onLinkBlobDocuments}
                disabled={indexingKnowledge}
                className="mt-2 w-full shrink-0 rounded-lg border border-emerald-600 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                Añadir {selectedBlobUrls.size} seleccionado(s) a knowledge
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeRagConfigSection({
  rag,
  onChange,
}: {
  rag: RagConfig;
  onChange: (rag: RagConfig) => void;
}) {
  return <RagConfigFields rag={rag} onChange={onChange} />;
}

export function KnowledgeConfigSection({
  knowledgePaths,
  rag,
  onRagChange,
  knowledgeInputRef,
  ...docsProps
}: {
  knowledgePaths: KnowledgeItem[];
  rag: RagConfig;
  onRagChange: (rag: RagConfig) => void;
  knowledgeInputRef?: RefObject<HTMLInputElement | null>;
} & Omit<Parameters<typeof KnowledgeDocsSection>[0], "knowledgePaths">) {
  return (
    <div className="space-y-3 pb-1">
      <KnowledgeDocsSection knowledgePaths={knowledgePaths} {...docsProps} />
      <KnowledgeRagConfigSection rag={rag} onChange={onRagChange} />
    </div>
  );
}
