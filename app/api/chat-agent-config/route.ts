import { NextResponse } from "next/server";
import { loadChatAgentConfig, saveChatAgentConfig } from "@/lib/chat-agent-config-server";
import { mergeChatAgentConfig } from "@/lib/chat-agent-config";

export async function GET() {
  try {
    const config = await loadChatAgentConfig();
    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const merged = mergeChatAgentConfig(body);
    await saveChatAgentConfig(merged);
    return NextResponse.json({ ok: true, ...merged });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
