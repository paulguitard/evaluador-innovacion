import type { StoredChunk } from "@/lib/chunk-types";

const DB_NAME = "evaluador_knowledge_index";
const DB_VERSION = 1;
const STORE_NAME = "indexes";

export type KnowledgeIndexCachePhase =
  | "checking"
  | "downloading"
  | "loading_local"
  | "ready"
  | "error";

export type KnowledgeIndexProgress = {
  phase: KnowledgeIndexCachePhase;
  bytes?: number;
  percent?: number;
  message?: string;
};

export type KnowledgeRagStatusClient = {
  hasIndex: boolean;
  knowledgeVersion: string | null;
  chunksDownloadUrl: string | null;
  chunksFileBytes: number;
  chunkCount: number;
};

type CachedEntry = {
  cacheKey: string;
  evaluationTypeId: number;
  knowledgeVersion: string;
  chunks: StoredChunk[];
  savedAt: string;
};

type PinnedEntry = {
  evaluationTypeId: number;
  knowledgeVersion: string;
  chunks: StoredChunk[];
};

let pinned: PinnedEntry | null = null;

function cacheKey(evaluationTypeId: number, knowledgeVersion: string): string {
  return `${evaluationTypeId}:${knowledgeVersion}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible en este navegador"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("Error al abrir IndexedDB"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function readFromIdb(cacheKeyStr: string): Promise<CachedEntry | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(cacheKeyStr);
    req.onerror = () => reject(req.error ?? new Error("Error leyendo IndexedDB"));
    req.onsuccess = () => resolve((req.result as CachedEntry | undefined) ?? null);
    tx.oncomplete = () => db.close();
  });
}

async function writeToIdb(entry: CachedEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(entry);
    req.onerror = () => reject(req.error ?? new Error("Error guardando IndexedDB"));
    req.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

async function deleteFromIdb(cacheKeyStr: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(cacheKeyStr);
    req.onerror = () => reject(req.error ?? new Error("Error borrando IndexedDB"));
    req.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

export async function fetchRagStatusClient(
  evaluationTypeId: number
): Promise<KnowledgeRagStatusClient> {
  const res = await fetch(`/api/config/${evaluationTypeId}/rag-status`);
  if (!res.ok) {
    throw new Error("No se pudo obtener el estado del índice RAG");
  }
  const data = (await res.json()) as KnowledgeRagStatusClient & { knowledgeConfigured?: boolean };
  return {
    hasIndex: !!data.hasIndex,
    knowledgeVersion: data.knowledgeVersion ?? null,
    chunksDownloadUrl: data.chunksDownloadUrl ?? null,
    chunksFileBytes: data.chunksFileBytes ?? 0,
    chunkCount: data.chunkCount ?? 0,
  };
}

async function downloadChunks(url: string, onProgress?: (p: KnowledgeIndexProgress) => void): Promise<StoredChunk[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Error al descargar índice (${res.status})`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (!res.body) {
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) throw new Error("Índice inválido");
    return data as StoredChunk[];
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        onProgress?.({
          phase: "downloading",
          bytes: contentLength,
          percent: Math.min(100, Math.round((received / contentLength) * 100)),
          message: "Descargando índice de referencia…",
        });
      }
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const text = new TextDecoder().decode(merged);
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Índice inválido");
  return parsed as StoredChunk[];
}

export type LocalIndexStatus =
  | "unknown"
  | "ready"
  | "update_available"
  | "missing"
  | "downloading";

export const KNOWLEDGE_INDEX_CHANGED_EVENT = "knowledge-index-changed";

export type KnowledgeIndexChangedDetail = {
  evaluationTypeId: number;
  status?: LocalIndexStatus;
};

export function notifyKnowledgeIndexChanged(
  evaluationTypeId: number,
  status?: LocalIndexStatus
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<KnowledgeIndexChangedDetail>(KNOWLEDGE_INDEX_CHANGED_EVENT, {
      detail: { evaluationTypeId, status },
    })
  );
}

export function pinKnowledgeIndex(
  evaluationTypeId: number,
  knowledgeVersion: string,
  chunks: StoredChunk[]
): void {
  pinned = { evaluationTypeId, knowledgeVersion, chunks };
  notifyKnowledgeIndexChanged(evaluationTypeId, "ready");
}

export function releasePinnedKnowledgeIndex(): void {
  const typeId = pinned?.evaluationTypeId;
  pinned = null;
  if (typeId != null) {
    void getLocalIndexStatus(typeId).then((r) => {
      notifyKnowledgeIndexChanged(typeId, r.status);
    });
  }
}

export function getPinnedKnowledgeIndex(
  evaluationTypeId: number,
  knowledgeVersion: string
): StoredChunk[] | null {
  if (
    pinned &&
    pinned.evaluationTypeId === evaluationTypeId &&
    pinned.knowledgeVersion === knowledgeVersion
  ) {
    return pinned.chunks;
  }
  return null;
}

export async function invalidateKnowledgeIndex(evaluationTypeId: number): Promise<void> {
  if (pinned?.evaluationTypeId === evaluationTypeId) {
    pinned = null;
  }
  try {
    const status = await fetchRagStatusClient(evaluationTypeId);
    if (status.knowledgeVersion) {
      await deleteFromIdb(cacheKey(evaluationTypeId, status.knowledgeVersion));
    }
  } catch {
    /* ignore */
  }
  void getLocalIndexStatus(evaluationTypeId).then((r) => {
    notifyKnowledgeIndexChanged(evaluationTypeId, r.status);
  });
}

export type EnsureKnowledgeIndexResult = {
  chunks: StoredChunk[];
  knowledgeVersion: string;
  source: "pin" | "indexeddb" | "download";
};

/**
 * Garantiza el índice en memoria: pin → IndexedDB → descarga Blob (solo si versión nueva).
 */
export async function ensureKnowledgeIndex(
  evaluationTypeId: number,
  onProgress?: (p: KnowledgeIndexProgress) => void
): Promise<EnsureKnowledgeIndexResult> {
  onProgress?.({ phase: "checking", message: "Comprobando índice local…" });

  const status = await fetchRagStatusClient(evaluationTypeId);
  if (!status.hasIndex || !status.knowledgeVersion) {
    throw new Error(
      "No hay índice RAG. Suba documentos en Knowledge y pulse Reindexar RAG en Configuración."
    );
  }

  const version = status.knowledgeVersion;
  const key = cacheKey(evaluationTypeId, version);

  const fromPin = getPinnedKnowledgeIndex(evaluationTypeId, version);
  if (fromPin) {
    onProgress?.({ phase: "ready", message: "Índice local listo (memoria)." });
    notifyKnowledgeIndexChanged(evaluationTypeId, "ready");
    return { chunks: fromPin, knowledgeVersion: version, source: "pin" };
  }

  onProgress?.({ phase: "loading_local", message: "Cargando índice desde almacenamiento local…" });
  try {
    const cached = await readFromIdb(key);
    if (cached?.chunks?.length) {
      pinKnowledgeIndex(evaluationTypeId, version, cached.chunks);
      onProgress?.({ phase: "ready", message: "Índice local listo." });
      return { chunks: cached.chunks, knowledgeVersion: version, source: "indexeddb" };
    }
  } catch {
    /* IndexedDB no disponible — continuar a descarga */
  }

  if (!status.chunksDownloadUrl) {
    throw new Error("URL de descarga del índice no disponible. Verifique la configuración Blob.");
  }

  onProgress?.({
    phase: "downloading",
    bytes: status.chunksFileBytes,
    message: "Descargando índice de referencia (solo la primera vez en este equipo)…",
  });
  notifyKnowledgeIndexChanged(evaluationTypeId, "downloading");

  const chunks = await downloadChunks(status.chunksDownloadUrl, onProgress);

  try {
    await writeToIdb({
      cacheKey: key,
      evaluationTypeId,
      knowledgeVersion: version,
      chunks,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(
      "[knowledge-index-cache] No se pudo guardar el índice en IndexedDB; se usará solo en memoria hasta recargar la página.",
      err
    );
  }

  pinKnowledgeIndex(evaluationTypeId, version, chunks);
  onProgress?.({ phase: "ready", message: "Índice descargado y guardado localmente." });
  return { chunks, knowledgeVersion: version, source: "download" };
}

export async function getLocalIndexStatus(evaluationTypeId: number): Promise<{
  status: LocalIndexStatus;
  knowledgeVersion: string | null;
}> {
  try {
    const remote = await fetchRagStatusClient(evaluationTypeId);
    if (!remote.hasIndex || !remote.knowledgeVersion) {
      return { status: "missing", knowledgeVersion: null };
    }
    const key = cacheKey(evaluationTypeId, remote.knowledgeVersion);
    if (getPinnedKnowledgeIndex(evaluationTypeId, remote.knowledgeVersion)) {
      return { status: "ready", knowledgeVersion: remote.knowledgeVersion };
    }
    const cached = await readFromIdb(key);
    if (cached?.chunks?.length) {
      return { status: "ready", knowledgeVersion: remote.knowledgeVersion };
    }
    return { status: "update_available", knowledgeVersion: remote.knowledgeVersion };
  } catch {
    return { status: "unknown", knowledgeVersion: null };
  }
}
