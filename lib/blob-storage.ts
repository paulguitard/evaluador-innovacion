import "server-only";

/** True when Vercel Blob storage should be used for persistent files. */
export function useBlobStorage(): boolean {
  return !!(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_STORE_ID?.trim()
  );
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
