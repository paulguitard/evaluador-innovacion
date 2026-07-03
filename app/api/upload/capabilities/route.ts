import { NextResponse } from "next/server";
import {
  canClientBlobUpload,
  canLegacyClientBlobUpload,
  canPresignedBlobUpload,
  useBlobStorage,
} from "@/lib/blob-storage";
import { MAX_VERCEL_SERVER_UPLOAD_BYTES } from "@/lib/upload-limits";

export async function GET() {
  return NextResponse.json({
    blobStorage: useBlobStorage(),
    clientBlobUpload: canClientBlobUpload(),
    presignedClientUpload: canPresignedBlobUpload(),
    legacyClientUpload: canLegacyClientBlobUpload(),
    maxServerUploadBytes: MAX_VERCEL_SERVER_UPLOAD_BYTES,
  });
}
