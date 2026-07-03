import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { put as blobPut } from "@vercel/blob";
import {
  getKnowledgeDir,
  getRubricPath,
  listSessionProjectFilePaths,
} from "@/lib/storage";
import { getConfig, updateConfig } from "@/lib/db";
import { getSupportedExtensions, getProjectUploadExtensions } from "@/lib/document-parser";
import { indexKnowledge } from "@/lib/rag-index";
import { ingestProjectFiles } from "@/lib/project-ingest";
import { saveProjectBuffersToSession } from "@/lib/session-project-files";
import { useBlobStorage } from "@/lib/blob-storage";

export const maxDuration = 300;

export type KnowledgeEntry = { name: string; url: string };

type UploadKind = "knowledge" | "rubric" | "project";

const ALLOWED_EXT = new Set(getSupportedExtensions());

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const kind = formData.get("kind") as UploadKind | null;
    if (!kind || !["knowledge", "rubric", "project"].includes(kind)) {
      return NextResponse.json({ error: "kind must be knowledge, rubric, or project" }, { status: 400 });
    }

    if (kind === "knowledge") {
      const typeIdStr = formData.get("evaluationTypeId");
      const typeId = typeIdStr ? Number(typeIdStr) : NaN;
      if (!Number.isInteger(typeId)) {
        return NextResponse.json({ error: "evaluationTypeId required for knowledge" }, { status: 400 });
      }
      const files = formData.getAll("files") as File[];
      const useBlob = useBlobStorage();

      if (useBlob) {
        const uploaded: KnowledgeEntry[] = [];
        for (const file of files) {
          if (!file?.name) continue;
          const ext = path.extname(file.name).toLowerCase();
          if (!ALLOWED_EXT.has(ext)) continue;
          const filename = sanitizeFilename(file.name);
          const pathname = `knowledge/${typeId}/${filename}`;
          const blob = await blobPut(pathname, file, { access: "public", addRandomSuffix: true });
          uploaded.push({ name: filename, url: blob.url });
        }
        const config = await getConfig(typeId);
        const current = (() => {
          try {
            const raw = JSON.parse(config?.knowledge_paths || "[]");
            return Array.isArray(raw) ? raw : [];
          } catch {
            return [];
          }
        })();
        const newEntries: KnowledgeEntry[] = [...current.filter((e): e is KnowledgeEntry => typeof e === "object" && e?.name != null && e?.url != null), ...uploaded];
        await updateConfig(typeId, { knowledge_paths: newEntries });
        let chunkCount: number | undefined;
        let indexError: string | undefined;
        try {
          const result = await indexKnowledge(typeId, {
            reindexDocNames: uploaded.map((u) => u.name),
          });
          chunkCount = result.chunkCount;
        } catch (e) {
          indexError = e instanceof Error ? e.message : String(e);
        }
        return NextResponse.json({
          saved: uploaded.map((u) => u.name),
          knowledge_paths: newEntries,
          chunkCount,
          indexError,
        });
      }

      const dir = getKnowledgeDir(typeId);
      const saved: string[] = [];
      for (const file of files) {
        if (!file?.name) continue;
        const ext = path.extname(file.name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) continue;
        const filename = sanitizeFilename(file.name);
        const filepath = path.join(dir, filename);
        const buf = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(filepath, buf);
        saved.push(filename);
      }
      const config = await getConfig(typeId);
      const currentPaths = config?.knowledge_paths ? (() => { try { return JSON.parse(config.knowledge_paths) as string[]; } catch { return []; } })() : [];
      const newPaths = [...new Set([...currentPaths, ...saved])];
      await updateConfig(typeId, { knowledge_paths: newPaths });
      let chunkCount: number | undefined;
      let indexError: string | undefined;
      try {
        const result = await indexKnowledge(typeId, { reindexDocNames: saved });
        chunkCount = result.chunkCount;
      } catch (e) {
        indexError = e instanceof Error ? e.message : String(e);
      }
      return NextResponse.json({ saved, knowledge_paths: newPaths, chunkCount, indexError });
    }

    if (kind === "rubric") {
      const typeIdStr = formData.get("evaluationTypeId");
      const typeId = typeIdStr ? Number(typeIdStr) : NaN;
      if (!Number.isInteger(typeId)) {
        return NextResponse.json({ error: "evaluationTypeId required for rubric" }, { status: 400 });
      }
      const file = formData.get("file") as File | null;
      if (!file?.name) {
        return NextResponse.json({ error: "file required for rubric" }, { status: 400 });
      }
      const ext = path.extname(file.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: "Unsupported file type for rubric" }, { status: 400 });
      }
      const useBlob = useBlobStorage();
      if (useBlob) {
        const filename = sanitizeFilename(file.name);
        const pathname = `rubric/${typeId}/${filename}`;
        const blob = await blobPut(pathname, file, { access: "public", addRandomSuffix: true });
        await updateConfig(typeId, { rubric_path: blob.url });
        return NextResponse.json({ rubric_path: blob.url });
      }
      const filepath = getRubricPath(typeId, file.name);
      const buf = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filepath, buf);
      const rubricPath = path.basename(filepath);
      await updateConfig(typeId, { rubric_path: rubricPath });
      return NextResponse.json({ rubric_path: rubricPath });
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
