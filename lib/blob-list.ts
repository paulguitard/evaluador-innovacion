import path from "path";
import { list } from "@vercel/blob";
import { getSupportedExtensions } from "@/lib/document-parser";
import { useBlobStorage } from "@/lib/blob-storage";

const ALLOWED_EXT = new Set(getSupportedExtensions());

export type BlobCatalogItem = {
  name: string;
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string;
};

function isKnowledgeBlobPathname(pathname: string): boolean {
  if (pathname.includes("/vectors/")) return false;
  const base = path.basename(pathname);
  if (base === "chunks.json" || base === "meta.json") return false;
  return ALLOWED_EXT.has(path.extname(pathname).toLowerCase());
}

/** Lista PDFs/docs en Vercel Blob (excluye índices RAG). */
export async function listKnowledgeBlobsInStore(): Promise<BlobCatalogItem[]> {
  if (!useBlobStorage()) return [];

  const items: BlobCatalogItem[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (!isKnowledgeBlobPathname(blob.pathname)) continue;
      items.push({
        name: path.basename(blob.pathname),
        pathname: blob.pathname,
        url: blob.url,
        size: blob.size,
        uploadedAt: blob.uploadedAt.toISOString(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return items;
}
