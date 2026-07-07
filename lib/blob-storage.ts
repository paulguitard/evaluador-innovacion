import "server-only";

/** Credenciales para operaciones servidor (list, head, put) con @vercel/blob. */
export function hasBlobServerAuth(): boolean {
  return !!(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    (process.env.BLOB_STORE_ID?.trim() && process.env.VERCEL_OIDC_TOKEN?.trim())
  );
}

/** True cuando hay almacenamiento Blob usable desde el servidor. */
export function useBlobStorage(): boolean {
  return hasBlobServerAuth();
}

/** Lanza si Blob no está configurado (knowledge, rúbrica, índice RAG). */
export function assertBlobStorageConfigured(): void {
  if (!useBlobStorage()) {
    throw new Error(
      "Almacenamiento Blob no configurado en el servidor. Añade BLOB_READ_WRITE_TOKEN en .env.local, " +
        "o ejecuta `npx vercel env pull .env.local` para obtener VERCEL_OIDC_TOKEN + BLOB_STORE_ID (ver docs/DEPLOY.md)."
    );
  }
}

/** Subida directa desde el navegador con token clásico (BLOB_READ_WRITE_TOKEN). */
export function canLegacyClientBlobUpload(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN?.trim();
}

/** Subida directa con OIDC + presigned (BLOB_STORE_ID + BLOB_WEBHOOK_PUBLIC_KEY). */
export function canPresignedBlobUpload(): boolean {
  return !!(
    process.env.BLOB_STORE_ID?.trim() &&
    process.env.BLOB_WEBHOOK_PUBLIC_KEY?.trim()
  );
}

/** Cualquier subida cliente (>4,5 MB) disponible. */
export function canClientBlobUpload(): boolean {
  return canLegacyClientBlobUpload() || canPresignedBlobUpload();
}

export function knowledgeBlobPrefix(evaluationTypeId: number): string {
  return `knowledge/${evaluationTypeId}`;
}

export function knowledgeVectorsBlobPath(evaluationTypeId: number, fileName: string): string {
  return `${knowledgeBlobPrefix(evaluationTypeId)}/vectors/${fileName}`;
}
