import { describe, expect, it } from "vitest";
import { buildPhrasingPrompt, parsePhrasingResponse, refinePhrasingWithLlm, type PhrasingCandidate } from "./llmPhrasing";
import type { LlmSettings } from "../../src/utils/llmClient";

const settings: LlmSettings = { baseUrl: "http://127.0.0.1:1234/v1", model: "test-model" };

describe("llmPhrasing", () => {
  describe("buildPhrasingPrompt", () => {
    it("includes candidate id, trigger type, template question, and context", () => {
      const candidates: PhrasingCandidate[] = [
        { candidateId: "cand-1", triggerType: "graph_gap", templateQuestion: "「A」はどの要素とも因果関係がありません。", context: "孤立ノード" },
      ];
      const prompt = buildPhrasingPrompt(candidates);
      expect(prompt).toContain("cand-1");
      expect(prompt).toContain("graph_gap");
      expect(prompt).toContain("因果関係がありません");
      expect(prompt).toContain("孤立ノード");
    });

    it("handles empty context", () => {
      const candidates: PhrasingCandidate[] = [
        { candidateId: "cand-1", triggerType: "silence", templateQuestion: "少し間が空きました。", context: "" },
      ];
      expect(buildPhrasingPrompt(candidates)).toContain("文脈情報なし");
    });
  });

  describe("parsePhrasingResponse", () => {
    it("parses a valid JSON response", () => {
      const raw = JSON.stringify({ phrasings: [{ id: "cand-1", question: "なぜそう思いましたか?" }] });
      const result = parsePhrasingResponse(raw, new Set(["cand-1"]));
      expect(result).toEqual([{ candidateId: "cand-1", questionText: "なぜそう思いましたか?" }]);
    });

    it("extracts JSON from code fences", () => {
      const raw = "```json\n" + JSON.stringify({ phrasings: [{ id: "cand-1", question: "どうしてですか?" }] }) + "\n```";
      const result = parsePhrasingResponse(raw, new Set(["cand-1"]));
      expect(result).toEqual([{ candidateId: "cand-1", questionText: "どうしてですか?" }]);
    });

    it("drops entries with unknown ids", () => {
      const raw = JSON.stringify({
        phrasings: [
          { id: "cand-1", question: "なぜですか?" },
          { id: "unknown-id", question: "無視されるべき" },
        ],
      });
      const result = parsePhrasingResponse(raw, new Set(["cand-1"]));
      expect(result).toEqual([{ candidateId: "cand-1", questionText: "なぜですか?" }]);
    });

    it("throws when the phrasings array is missing", () => {
      expect(() => parsePhrasingResponse(JSON.stringify({}), new Set(["cand-1"]))).toThrow();
    });

    it("throws when nothing valid survives filtering", () => {
      const raw = JSON.stringify({ phrasings: [{ id: "unknown-id", question: "x" }] });
      expect(() => parsePhrasingResponse(raw, new Set(["cand-1"]))).toThrow();
    });
  });

  describe("refinePhrasingWithLlm", () => {
    it("returns an empty array without calling chat when there are no candidates", async () => {
      let called = false;
      const fakeChat = async () => {
        called = true;
        return "{}";
      };
      const result = await refinePhrasingWithLlm(settings, [], fakeChat);
      expect(result).toEqual([]);
      expect(called).toBe(false);
    });

    it("returns phrasing on a successful chat call (LLM path)", async () => {
      const candidates: PhrasingCandidate[] = [
        { candidateId: "cand-1", triggerType: "silence", templateQuestion: "少し間が空きました。", context: "" },
      ];
      const fakeChat = async () => JSON.stringify({ phrasings: [{ id: "cand-1", question: "今どんなことを考えていますか?" }] });

      const result = await refinePhrasingWithLlm(settings, candidates, fakeChat);
      expect(result).toEqual([{ candidateId: "cand-1", questionText: "今どんなことを考えていますか?" }]);
    });

    it("propagates a rejection when chat fails, leaving the caller to keep the template (fallback path)", async () => {
      const candidates: PhrasingCandidate[] = [
        { candidateId: "cand-1", triggerType: "silence", templateQuestion: "少し間が空きました。", context: "" },
      ];
      const fakeChat = async () => {
        throw new Error("LM Studio unreachable");
      };

      await expect(refinePhrasingWithLlm(settings, candidates, fakeChat)).rejects.toThrow("LM Studio unreachable");
    });
  });
});
