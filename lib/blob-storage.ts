import "server-only";

/** True when Vercel Blob storage should be used for persistent files. */
export function useBlobStorage(): boolean {
  return !!(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_STORE_ID?.trim()
  );
}

/** Client uploads (archivos >4,5 MB) requieren BLOB_READ_WRITE_TOKEN; BLOB_STORE_ID solo no basta. */
export function canClientBlobUpload(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN?.trim();
}

export function knowledgeBlobPrefix(evaluationTypeId: number): string {
  return `knowledge/${evaluationTypeId}`;
}

export function knowledgeVectorsBlobPath(evaluationTypeId: number, fileName: string): string {
  return `${knowledgeBlobPrefix(evaluationTypeId)}/vectors/${fileName}`;
}
