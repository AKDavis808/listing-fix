/**
 * Minimal server-only OpenAI REST client. Model is env-configurable for easy swaps.
 */

const DEFAULT_MODEL = "gpt-4o-mini";

function resolveModel(explicit?: string): string {
  const fromEnv = process.env.OPENAI_MODEL?.trim();
  return (explicit ?? fromEnv ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export type OpenAiJsonResult =
  | { ok: true; rawText: string }
  | { ok: false; error: string };

/**
 * Calls Chat Completions with JSON mode. API key never leaves this module.
 */
export async function openAiChatCompletionJson(input: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxCompletionTokens?: number;
}): Promise<OpenAiJsonResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "OpenAI is not configured. Add OPENAI_API_KEY to your environment.",
    };
  }

  const model = resolveModel(input.model);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: input.temperature ?? 0.35,
        max_tokens: input.maxCompletionTokens ?? 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        error: `OpenAI request failed (${res.status}): ${errBody.slice(0, 280)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      return { ok: false, error: data.error.message };
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, error: "OpenAI returned an empty response." };
    }

    return { ok: true, rawText: text };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "OpenAI network error.";
    return { ok: false, error: msg };
  }
}
