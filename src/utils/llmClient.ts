export type LlmSettings = {
  baseUrl: string;
  model: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "",
};

// Local models can keep generating despite a JSON-only instruction. Keep every
// non-streaming request bounded so one malformed response cannot occupy a slot
// indefinitely or force a context shift.
export const DEFAULT_CHAT_MAX_TOKENS = 800;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

// LM Studio exposes an OpenAI-compatible server; this client only depends on
// /models and /chat/completions so any compatible local server works.
export async function fetchModelIds(settings: LlmSettings): Promise<string[]> {
  const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/models`);
  if (!response.ok) {
    throw new Error(`モデル一覧の取得に失敗しました: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (payload.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
}

export async function requestChat(
  settings: LlmSettings,
  messages: ChatMessage[],
  options: { maxTokens?: number } = {},
): Promise<string> {
  const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0,
      max_tokens: options.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM呼び出しに失敗しました: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }> };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    if (choice?.finish_reason === "length") {
      throw new Error("LLM応答が出力上限に達したため、JSON本文を受け取れませんでした。");
    }
    throw new Error("LLM応答にcontentがありません。");
  }
  return content;
}

// Local models often wrap JSON in code fences or prepend reasoning text,
// so parse the outermost JSON object instead of the raw response.
export function extractJsonObject(raw: string): unknown {
  const withoutFences = raw.replace(/```(?:json)?/gi, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM応答からJSONを抽出できません。");
  }
  return JSON.parse(withoutFences.slice(start, end + 1));
}
