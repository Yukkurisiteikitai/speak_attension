import { logRuntimeEvent } from "../lib/runtimeLog";

export type LlmSettings = {
  provider: "lmstudio";
  baseUrl: string;
  model: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "lmstudio",
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "",
};

const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

// Settings are kept in localStorage. Treat old or manually entered remote
// endpoints as invalid rather than sending a brainstorm transcript away from
// the local LM Studio server.
export function isLmStudioBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      && url.port === "1234"
      && url.pathname.replace(/\/+$/, "") === "/v1";
  } catch {
    return false;
  }
}

export function restoreLocalLlmSettings(settings: Partial<LlmSettings>): LlmSettings {
  if (!isLmStudioBaseUrl(settings.baseUrl ?? "")) return DEFAULT_LLM_SETTINGS;
  return {
    provider: "lmstudio",
    baseUrl: settings.baseUrl ?? LM_STUDIO_BASE_URL,
    model: settings.model ?? "",
  };
}

export function providerLabel(): string {
  return "LM Studio";
}

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
  try {
    if (!isLmStudioBaseUrl(settings.baseUrl)) {
      throw new Error("接続先は LM Studio の http://127.0.0.1:1234/v1 を指定してください。");
    }
    const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/models`);
    if (!response.ok) throw new Error(`モデル一覧の取得に失敗しました: HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const modelIds = (payload.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
    logRuntimeEvent("llm.models.loaded", "info", undefined, { provider: settings.provider, count: modelIds.length });
    return modelIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logRuntimeEvent("llm.models.failed", "error", message, { provider: settings.provider, baseUrl: settings.baseUrl });
    throw error;
  }
}

export async function requestChat(
  settings: LlmSettings,
  messages: ChatMessage[],
  options: { maxTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  try {
    if (!isLmStudioBaseUrl(settings.baseUrl)) {
      throw new Error("接続先は LM Studio の http://127.0.0.1:1234/v1 を指定してください。");
    }
    const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: options.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0,
        max_tokens: options.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`LLM呼び出しに失敗しました: HTTP ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }> };
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      if (choice?.finish_reason === "length") throw new Error("LLM応答が出力上限に達したため、JSON本文を受け取れませんでした。");
      throw new Error("LLM応答にcontentがありません。");
    }
    logRuntimeEvent("llm.chat.completed", "info", undefined, { provider: settings.provider, model: settings.model, maxTokens: options.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS });
    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logRuntimeEvent("llm.chat.failed", "error", message, { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl });
    throw error;
  }
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
