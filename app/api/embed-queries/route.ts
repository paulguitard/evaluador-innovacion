import { NextResponse } from "next/server";
import { embedTexts } from "@/lib/embeddings";
import { assertLlmModelsConfigured } from "@/lib/llm-config-server";

const MAX_TEXTS = 16;
const MAX_TEXT_CHARS = 8_000;

export async function POST(request: Request) {
  try {
    await assertLlmModelsConfigured();
    const body = await request.json();
    const textsRaw = Array.isArray(body?.texts) ? body.texts : [];
    const texts = textsRaw
      .filter((t: unknown) => typeof t === "string")
      .map((t: string) => t.trim().slice(0, MAX_TEXT_CHARS))
      .filter(Boolean)
      .slice(0, MAX_TEXTS);

    if (texts.length === 0) {
      return NextResponse.json({ error: "texts array required" }, { status: 400 });
    }

    const embeddings = await embedTexts(texts);
    return NextResponse.json({ embeddings });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
