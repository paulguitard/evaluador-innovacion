/**
 * OpenRouter API (OpenAI-compatible). https://openrouter.ai/
 * Uses OPENROUTER_API_KEY and the model id (default: openrouter/free).
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/free";
const EXTRACT_VISION_MODEL = "openrouter/free";

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) {
    throw new Error("OPENROUTER_API_KEY is not set in environment");
  }
  return key.trim();
}

export async function* streamChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { temperature?: number; max_tokens?: number; model?: string }
): AsyncGenerator<string, void, unknown> {
  const apiKey = getApiKey();
  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const maxTokens = options?.max_tokens ?? 8192;
  const temperature = options?.temperature ?? 0.3;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${res.status} ${errBody}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (typeof content === "string") yield content;
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  }
}

export type VisionMessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Chat completion with vision (no stream). For document extraction. */
export async function chatCompletionVision(
  messages: { role: "system" | "user" | "assistant"; content: string | VisionMessageContent[] }[],
  options?: { max_tokens?: number; model?: string }
): Promise<string> {
  const apiKey = getApiKey();
  const model =
    options?.model ??
    process.env.OPENROUTER_EXTRACT_MODEL ??
    EXTRACT_VISION_MODEL;
  const maxTokens = options?.max_tokens ?? 4096;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${res.status} ${errBody}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

/** One-shot text completion (no stream, no vision). For structuring text. */
export async function chatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { max_tokens?: number; model?: string }
): Promise<string> {
  const apiKey = getApiKey();
  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const maxTokens = options?.max_tokens ?? 4096;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${res.status} ${errBody}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export { DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL };
