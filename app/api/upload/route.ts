import { NextResponse } from "next/server";
import path from "path";
import { put as blobPut } from "@vercel/blob";
import { listSessionProjectFilePaths } from "@/lib/storage";
import { getSupportedExtensions, getProjectUploadExtensions } from "@/lib/document-parser";
import { ingestProjectFiles } from "@/lib/project-ingest";
import { saveProjectBuffersToSession } from "@/lib/session-project-files";
import { assertBlobStorageConfigured } from "@/lib/blob-storage";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import {
  registerKnowledgeUploads,
  type KnowledgeEntry,
} from "@/lib/knowledge-upload";
import { MAX_VERCEL_SERVER_UPLOAD_BYTES } from "@/lib/upload-limits";

export const maxDuration = 300;

type UploadKind = "knowledge" | "project";

const ALLOWED_EXT = new Set(getSupportedExtensions());

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const kind = formData.get("kind") as UploadKind | null;
    if (!kind || !["knowledge", "project"].includes(kind)) {
      return NextResponse.json({ error: "kind must be knowledge or project" }, { status: 400 });
    }

    if (kind === "knowledge") {
      assertBlobStorageConfigured();
      const typeIdStr = formData.get("evaluationTypeId");
      const typeId = typeIdStr ? Number(typeIdStr) : NaN;
      if (!Number.isInteger(typeId)) {
        return NextResponse.json({ error: "evaluationTypeId required for knowledge" }, { status: 400 });
      }
      const files = formData.getAll("files") as File[];
      const uploaded: KnowledgeEntry[] = [];
      for (const file of files) {
        if (!file?.name) continue;
        const ext = path.extname(file.name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) continue;
        if (file.size >= MAX_VERCEL_SERVER_UPLOAD_BYTES) {
          return NextResponse.json(
            {
              error: `El archivo "${file.name}" supera 4,5 MB. Usa la subida directa a Blob desde el navegador.`,
            },
            { status: 413 }
          );
        }
        const filename = sanitizeFilename(file.name);
        const pathname = `knowledge/${typeId}/${filename}`;
        const blob = await blobPut(pathname, file, { access: "public", addRandomSuffix: true });
        uploaded.push({ name: filename, url: blob.url });
      }
      const result = await registerKnowledgeUploads(typeId, uploaded);
      return NextResponse.json(result);
    }

    if (kind === "project") {
      const sessionId = (formData.get("sessionId") as string) || "default";
      const files = formData.getAll("files") as File[];
      const projectAllowed = new Set(getProjectUploadExtensions());
      const replaceExisting = formData.get("replace") !== "false";
      const buffers: { name: string; buffer: Buffer }[] = [];
      for (const file of files) {
        if (!file?.name) continue;
        const ext = path.extname(file.name).toLowerCase();
        if (!projectAllowed.has(ext)) continue;
        buffers.push({
          name: file.name,
          buffer: Buffer.from(await file.arrayBuffer()),
        });
      }
      const allSessionPaths =
        buffers.length > 0
          ? saveProjectBuffersToSession(sessionId, buffers, { replace: replaceExisting })
          : listSessionProjectFilePaths(sessionId, [...projectAllowed]);
      let projectChunkCount: number | undefined;
      let structuredIndexed: boolean | undefined;
      let projectIndexError: string | undefined;
      if (allSessionPaths.length > 0) {
        try {
          const result = await ingestProjectFiles(sessionId, allSessionPaths);
          projectChunkCount = result.chunkCount;
          structuredIndexed = result.structuredFileCount > 0;
        } catch (e) {
          projectIndexError = e instanceof Error ? e.message : String(e);
        }
      }
      return NextResponse.json({
        saved: allSessionPaths.map((p) => path.basename(p)),
        paths: allSessionPaths,
        projectChunkCount,
        structuredIndexed,
        projectIndexError,
      });
    }

    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
