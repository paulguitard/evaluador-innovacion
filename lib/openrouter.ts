/**
 * OpenRouter API (OpenAI-compatible). https://openrouter.ai/
 * API key: OPENROUTER_API_KEY. Modelos: UI «Configurar LLM» (base de datos).
 */

import "server-only";

import {
  getApiKey,
  resolveModelForUseCase,
  resolveParamsForUseCase,
} from "@/lib/llm-config-server";
import type { LlmUseCase } from "@/lib/llm-config-types";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const EMBEDDING_BATCH_SIZE = 16;

export type OpenRouterCallOptions = {
  temperature?: number;
  max_tokens?: number;
  model?: string;
  useCase?: LlmUseCase;
  /** Deshabilita/minimiza tokens de reasoning en modelos que soportan `reasoning` param
   *  (algunos providers de gpt-oss consumen todo el presupuesto en thinking invisible
   *   sin emitir content). Usar en secciones donde solo interesa el output final. */
  disableReasoning?: boolean;
};

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  };
}

/** Reintentos breves ante 429/402 (misma clave y modelo). */
const MAX_LLM_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function retryDelayMs(attempt: number): number {
  return RETRY_BASE_MS * Math.pow(2, Math.min(attempt - 1, 2));
}

async function runWithRetries<T>(
  useCase: LlmUseCase,
  run: (model: string, apiKey: string) => Promise<T>,
  options?: { modelOverride?: string; formatError?: boolean }
): Promise<T> {
  const model = await resolveModelForUseCase(useCase, options?.modelOverride);
  const apiKey = getApiKey();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      return await run(model, apiKey);
    } catch (e) {
      lastErr = e;
      if (!isRetryableProviderError(e) || attempt === MAX_LLM_RETRIES) {
        if (options?.formatError) throw new Error(formatProviderError(e));
        throw e;
      }
      await sleep(retryDelayMs(attempt));
    }
  }
  if (options?.formatError) throw new Error(formatProviderError(lastErr));
  throw lastErr;
}

/** Mensaje legible para el usuario (evita JSON crudo de OpenRouter). */
export function formatProviderError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("429")) {
    let model = "el modelo configurado";
    try {
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(raw.slice(jsonStart)) as {
          error?: { metadata?: { raw?: string } };
        };
        const upstream = parsed.error?.metadata?.raw ?? "";
        const m = upstream.match(/[\w-]+\/[\w.:+-]+/) ?? raw.match(/[\w-]+\/[\w.:+-]+/);
        if (m) model = m[0];
      }
    } catch {
      const m = raw.match(/[\w-]+\/[\w.:+-]+/);
      if (m) model = m[0];
    }
    return (
      `Límite de tasa del proveedor (${model}): OpenRouter rechazó la petición tras varios reintentos. ` +
      `Espere un momento y vuelva a intentar, o revise el modelo en Configurar LLM.`
    );
  }
  if (raw.includes("402")) {
    return (
      "Crédito insuficiente en OpenRouter. Revise el saldo de su cuenta o el modelo configurado."
    );
  }
  if (raw.length > 280) return raw.slice(0, 280) + "…";
  return raw;
}

/** Errores que OpenRouter puede resolver en otro intento (429 rate limit, 402 spend limit). */
function isRetryableProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("402");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function* streamChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: OpenRouterCallOptions
): AsyncGenerator<string, void, unknown> {
  const useCase = options?.useCase ?? "evaluate";
  const resolved = await resolveParamsForUseCase(useCase);
  const maxTokens = options?.max_tokens ?? resolved.max_tokens;
  const temperature = options?.temperature ?? resolved.temperature;

  const res = await runWithRetries(
    useCase,
    async (model, apiKey) => {
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature,
      };
      // Fuerza a proveedores que soportan reasoning a NO gastar tokens en thinking.
      // Sin esto, providers como Phala/Google-Vertex/Groq de gpt-oss consumen todo el
      // presupuesto en reasoning invisible y devuelven content vacío.
      if (options?.disableReasoning) {
        body.reasoning = { effort: "low", exclude: true };
      }
      const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`${response.status} ${errBody}`);
      }
      return response;
    },
    { modelOverride: options?.model }
  );

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

export type ChatStreamPart = { kind: "content" | "thinking"; text: string };

const THINK_END_RE = /<\/think>|<\/redacted_thinking>/i;
const THINK_START_RE = /<think>|<think>/i;
const PARTIAL_TAG_RE = /<(?:\/?think(?:ing)?|redacted_thinking)?$/i;

/** Separa razonamiento (etiquetas think / delta.reasoning) del contenido visible. */
function* flushThinkSplitter(
  splitter: { inThink: boolean; carry: string },
  delta: string
): Generator<ChatStreamPart> {
  splitter.carry += delta;
  while (splitter.carry.length > 0) {
    if (splitter.inThink) {
      const endMatch = splitter.carry.match(THINK_END_RE);
      if (endMatch && endMatch.index !== undefined) {
        const thinkPart = splitter.carry.slice(0, endMatch.index);
        if (thinkPart) yield { kind: "thinking", text: thinkPart };
        splitter.carry = splitter.carry.slice(endMatch.index + endMatch[0].length);
        splitter.inThink = false;
        continue;
      }
      if (splitter.carry.length > 40) {
        yield { kind: "thinking", text: splitter.carry.slice(0, -30) };
        splitter.carry = splitter.carry.slice(-30);
      }
      break;
    }

    const startMatch = splitter.carry.match(THINK_START_RE);
    if (startMatch && startMatch.index !== undefined) {
      const before = splitter.carry.slice(0, startMatch.index);
      if (before) yield { kind: "content", text: before };
      splitter.carry = splitter.carry.slice(startMatch.index + startMatch[0].length);
      splitter.inThink = true;
      continue;
    }

    const partial = splitter.carry.match(PARTIAL_TAG_RE);
    if (partial && partial.index !== undefined && partial.index > 0) {
      yield { kind: "content", text: splitter.carry.slice(0, partial.index) };
      splitter.carry = splitter.carry.slice(partial.index);
      break;
    }
    if (partial) break;

    yield { kind: "content", text: splitter.carry };
    splitter.carry = "";
  }
}

function* drainThinkSplitter(splitter: { inThink: boolean; carry: string }): Generator<ChatStreamPart> {
  if (!splitter.carry) return;
  yield { kind: splitter.inThink ? "thinking" : "content", text: splitter.carry };
  splitter.carry = "";
}

/** Igual que streamChat pero distingue razonamiento (thinking) de la respuesta final. */
export async function* streamChatDetailed(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: OpenRouterCallOptions
): AsyncGenerator<ChatStreamPart, void, unknown> {
  const useCase = options?.useCase ?? "chat";
  const resolved = await resolveParamsForUseCase(useCase);
  const maxTokens = options?.max_tokens ?? resolved.max_tokens;
  const temperature = options?.temperature ?? resolved.temperature;

  const res = await runWithRetries(
    useCase,
    async (model, apiKey) => {
      const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`${response.status} ${errBody}`);
      }
      return response;
    },
    { modelOverride: options?.model, formatError: true }
  );

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  const splitter = { inThink: false, carry: "" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        const reasoning =
          (typeof delta?.reasoning === "string" && delta.reasoning) ||
          (typeof delta?.reasoning_content === "string" && delta.reasoning_content);
        if (reasoning) yield { kind: "thinking", text: reasoning };

        const content = delta?.content;
        if (typeof content === "string" && content) {
          yield* flushThinkSplitter(splitter, content);
        }
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
  yield* drainThinkSplitter(splitter);
}

export type VisionMessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Chat completion with vision (no stream). For document extraction. */
export async function chatCompletionVision(
  messages: { role: "system" | "user" | "assistant"; content: string | VisionMessageContent[] }[],
  options?: { max_tokens?: number; model?: string; useCase?: LlmUseCase }
): Promise<string> {
  const useCase = options?.useCase ?? "vision";
  const resolved = await resolveParamsForUseCase(useCase);
  const maxTokens = options?.max_tokens ?? resolved.max_tokens;

  return runWithRetries(
    useCase,
    async (model, apiKey) => {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
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
    },
    { modelOverride: options?.model }
  );
}

/** One-shot text completion (no stream, no vision). For structuring text. */
export async function chatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { max_tokens?: number; model?: string; temperature?: number; useCase?: LlmUseCase }
): Promise<string> {
  const useCase = options?.useCase ?? "extract";
  const resolved = await resolveParamsForUseCase(useCase);
  const maxTokens = options?.max_tokens ?? resolved.max_tokens;
  const temperature = options?.temperature ?? resolved.temperature;

  return runWithRetries(
    useCase,
    async (model, apiKey) => {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${res.status} ${errBody}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    },
    { modelOverride: options?.model }
  );
}

export type OpenAIToolDef = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolCallResult = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ToolCompletionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Completion con function calling (bucle agente Nivel B/C). */
export async function chatCompletionWithTools(
  messages: ToolCompletionMessage[],
  tools: OpenAIToolDef[],
  options?: { max_tokens?: number; temperature?: number; model?: string; useCase?: LlmUseCase }
): Promise<{ content: string | null; toolCalls: ToolCallResult[] }> {
  const useCase = options?.useCase ?? "agent";
  const resolved = await resolveParamsForUseCase(useCase);
  const maxTokens = options?.max_tokens ?? resolved.max_tokens;
  const temperature = options?.temperature ?? resolved.temperature;

  return runWithRetries(
    useCase,
    async (model, apiKey) => {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          stream: false,
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${res.status} ${errBody}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };
      const message = data.choices?.[0]?.message;
      const content = message?.content ?? null;
      const toolCalls: ToolCallResult[] = (message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolArguments(tc.function.arguments),
      }));
      return { content, toolCalls };
    },
    { modelOverride: options?.model }
  );
}

type EmbeddingResponse = {
  data?: { index: number; embedding: number[] }[];
};

/** Generate embeddings for one or more texts (RAG indexing and retrieval). */
export async function createEmbeddings(
  input: string[],
  options?: { model?: string; useCase?: LlmUseCase }
): Promise<number[][]> {
  if (input.length === 0) return [];
  const useCase = options?.useCase ?? "embeddings";

  return runWithRetries(
    useCase,
    async (model, apiKey) => {
      const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify({ model, input }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${res.status} ${errBody}`);
      }
      const data = (await res.json()) as EmbeddingResponse;
      const rows = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
      return rows.map((row) => row.embedding ?? []);
    },
    { modelOverride: options?.model }
  );
}

/** Batch embeddings for RAG (chunk indexing). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE).map((t) => t?.trim() || " ");
    const vectors = await createEmbeddings(batch);
    results.push(...vectors);
  }
  return results;
}

/** Single-query embedding for RAG retrieval. */
export async function embedQuery(query: string): Promise<number[]> {
  const vectors = await embedTexts([query.trim() || " "]);
  return vectors[0] ?? [];
}

