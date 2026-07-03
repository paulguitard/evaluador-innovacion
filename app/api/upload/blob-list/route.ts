import { NextResponse } from "next/server";
import { listKnowledgeBlobsInStore } from "@/lib/blob-list";
import { useBlobStorage } from "@/lib/blob-storage";

export async function GET() {
  try {
    if (!useBlobStorage()) {
      return NextResponse.json({ blobs: [], blobStorage: false });
    }
    const blobs = await listKnowledgeBlobsInStore();
    return NextResponse.json({ blobs, blobStorage: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
