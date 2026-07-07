import "server-only";

import { getChatAgentConfigPostgres, saveChatAgentConfigPostgres } from "@/lib/db-postgres";
import { defaultChatAgentConfig, mergeChatAgentConfig, type ChatAgentConfig } from "@/lib/chat-agent-config";

export async function loadChatAgentConfig(): Promise<ChatAgentConfig> {
  const fromDb = await getChatAgentConfigPostgres();
  return mergeChatAgentConfig(fromDb ?? undefined);
}

export async function saveChatAgentConfig(config: ChatAgentConfig): Promise<void> {
  await saveChatAgentConfigPostgres(mergeChatAgentConfig(config));
}

export function getDefaultChatAgentConfig(): ChatAgentConfig {
  return defaultChatAgentConfig();
}
