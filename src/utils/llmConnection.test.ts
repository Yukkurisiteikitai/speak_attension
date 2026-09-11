import { describe, expect, it } from "vitest";
import { checkLlmConnection } from "./llmConnection";

const settings = { provider: "lmstudio" as const, baseUrl: "http://127.0.0.1:1234/v1", model: "" };

describe("checkLlmConnection", () => {
  it("reports success and autofills the first model when none is set", async () => {
    const result = await checkLlmConnection(settings, async () => ["model-a", "model-b"]);

    expect(result.statusMessage).toBe("LM Studio 接続成功: model-a, model-b");
    expect(result.autofillModel).toBe("model-a");
  });

  it("does not autofill when a model is already set", async () => {
    const result = await checkLlmConnection({ ...settings, model: "chosen" }, async () => ["model-a"]);

    expect(result.autofillModel).toBeNull();
  });

  it("reports when the server has no loaded models", async () => {
    const result = await checkLlmConnection(settings, async () => []);

    expect(result.statusMessage).toBe("接続はできましたが、利用可能なモデルがありません。");
    expect(result.autofillModel).toBeNull();
  });

  it("turns fetch errors into a failure message", async () => {
    const result = await checkLlmConnection(settings, async () => {
      throw new Error("HTTP 500");
    });

    expect(result.statusMessage).toBe("接続失敗: HTTP 500");
    expect(result.autofillModel).toBeNull();
  });
});
