import Groq from "groq-sdk";

const model = "qwen/qwen3-32b";

export function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment");
  }
  return new Groq({ apiKey });
}

export async function* streamChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { temperature?: number; max_tokens?: number }
): AsyncGenerator<string, void, unknown> {
  const client = getGroqClient();
  const maxTokens = options?.max_tokens ?? 8192;
  let stream;
  try {
    stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.3,
      max_tokens: maxTokens,
    });
  } catch (createErr) {
    throw createErr;
  }

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}

export { model as GROQ_MODEL };
