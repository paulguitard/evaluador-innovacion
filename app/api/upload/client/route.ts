import { NextResponse } from "next/server";
import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import {
  canClientBlobUpload,
  canLegacyClientBlobUpload,
  canPresignedBlobUpload,
  useBlobStorage,
} from "@/lib/blob-storage";
import {
  KNOWLEDGE_CONTENT_TYPES,
  validateKnowledgeUploadPath,
} from "@/lib/upload-client-auth";

export const maxDuration = 60;

const UPLOAD_TOKEN_OPTS = {
  allowedContentTypes: KNOWLEDGE_CONTENT_TYPES,
  maximumSizeInBytes: 50 * 1024 * 1024,
  addRandomSuffix: true,
} as const;

async function onBeforeGenerateToken(pathname: string, clientPayload: string | null) {
  await validateKnowledgeUploadPath(pathname, clientPayload);
  return {
    ...UPLOAD_TOKEN_OPTS,
    tokenPayload: clientPayload,
  };
}

async function getSignedToken(pathname: string, clientPayload: string | null) {
  await validateKnowledgeUploadPath(pathname, clientPayload);
  const token = await issueSignedToken({
    pathname,
    operations: ["put"],
    allowedContentTypes: KNOWLEDGE_CONTENT_TYPES,
    maximumSizeInBytes: 50 * 1024 * 1024,
  });
  return {
    token,
    urlOptions: {
      ...UPLOAD_TOKEN_OPTS,
      tokenPayload: clientPayload,
    },
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!useBlobStorage()) {
    return NextResponse.json({ error: "Blob storage no configurado" }, { status: 400 });
  }
  if (!canClientBlobUpload()) {
    return NextResponse.json(
      {
        error:
          "Falta configuración Blob. Conecta el store al proyecto (BLOB_STORE_ID + BLOB_WEBHOOK_PUBLIC_KEY) o añade BLOB_READ_WRITE_TOKEN.",
      },
      { status: 503 }
    );
  }

  const body = (await request.json()) as HandleUploadBody | HandleUploadPresignedBody;

  try {
    if (body.type === "blob.generate-presigned-url") {
      if (!canPresignedBlobUpload()) {
        return NextResponse.json(
          { error: "Falta BLOB_WEBHOOK_PUBLIC_KEY para subida presigned." },
          { status: 503 }
        );
      }
      const jsonResponse = await handleUploadPresigned({
        body,
        request,
        getSignedToken,
      });
      return NextResponse.json(jsonResponse);
    }

    if (!canLegacyClientBlobUpload()) {
      return NextResponse.json(
        {
          error:
            "Subida legacy no disponible. Usa uploadPresigned (requiere BLOB_WEBHOOK_PUBLIC_KEY).",
        },
        { status: 503 }
      );
    }

    const jsonResponse = await handleUpload({
      body: body as HandleUploadBody,
      request,
      onBeforeGenerateToken: onBeforeGenerateToken,
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
