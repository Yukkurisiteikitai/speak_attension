import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_MAX_TOKENS, requestChat, type LlmSettings } from "./llmClient";

afterEach(() => vi.unstubAllGlobals());

describe("requestChat", () => {
  it("sends a bounded max_tokens value to the local server", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const settings: LlmSettings = { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" };

    await requestChat(settings, [{ role: "user", content: "test" }]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).max_tokens).toBe(DEFAULT_CHAT_MAX_TOKENS);
  });

  it("explains when the local model reaches the output limit before returning content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {}, finish_reason: "length" }] }),
    }));
    const settings: LlmSettings = { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" };

    await expect(requestChat(settings, [{ role: "user", content: "test" }])).rejects.toThrow("出力上限");
  });
});
