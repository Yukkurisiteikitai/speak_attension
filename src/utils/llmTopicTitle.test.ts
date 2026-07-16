import { describe, expect, it } from "vitest";
import {
  buildTitleRefinePrompt,
  parseTitleRefineResponse,
  refineTopicTitlesWithLlm,
  type TopicTitleCandidate,
} from "./llmTopicTitle";
import type { LlmSettings } from "./llmClient";

describe("llmTopicTitle", () => {
  describe("buildTitleRefinePrompt", () => {
    it("includes topic IDs, current titles, and evidence quotes", () => {
      const candidates: TopicTitleCandidate[] = [
        {
          topicId: "topic1",
          currentTitle: "レイテンシー対策",
          evidenceQuotes: ["待ち時間が長い", "対応が必要"],
        },
      ];

      const prompt = buildTitleRefinePrompt(candidates);
      expect(prompt).toContain("topic1");
      expect(prompt).toContain("レイテンシー対策");
      expect(prompt).toContain("待ち時間が長い");
      expect(prompt).toContain("対応が必要");
    });

    it("handles empty evidence quotes", () => {
      const candidates: TopicTitleCandidate[] = [
        {
          topicId: "topic1",
          currentTitle: "テスト",
          evidenceQuotes: [],
        },
      ];

      const prompt = buildTitleRefinePrompt(candidates);
      expect(prompt).toContain("topic1");
      expect(prompt).toContain("テスト");
      expect(prompt).toContain("発言の証拠は記録されていません");
    });
  });

  describe("parseTitleRefineResponse", () => {
    it("parses valid JSON response", () => {
      const raw = JSON.stringify({
        titles: [
          { id: "topic1", title: "新しいタイトル" },
          { id: "topic2", title: "別のタイトル" },
        ],
      });
      const validIds = new Set(["topic1", "topic2"]);

      const result = parseTitleRefineResponse(raw, validIds);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ topicId: "topic1", title: "新しいタイトル" });
    });

    it("extracts JSON from code fences", () => {
      const raw = `
      \`\`\`json
      {"titles":[{"id":"topic1","title":"タイトル"}]}
      \`\`\`
      `;
      const validIds = new Set(["topic1"]);

      const result = parseTitleRefineResponse(raw, validIds);
      expect(result).toHaveLength(1);
      expect(result[0].topicId).toBe("topic1");
    });

    it("drops entries with unknown topic IDs", () => {
      const raw = JSON.stringify({
        titles: [
          { id: "topic1", title: "タイトル1" },
          { id: "unknown", title: "タイトル2" },
        ],
      });
      const validIds = new Set(["topic1"]);

      const result = parseTitleRefineResponse(raw, validIds);
      expect(result).toHaveLength(1);
      expect(result[0].topicId).toBe("topic1");
    });

    it("drops entries with empty titles", () => {
      const raw = JSON.stringify({
        titles: [
          { id: "topic1", title: "タイトル" },
          { id: "topic2", title: "" },
          { id: "topic3", title: "   " },
        ],
      });
      const validIds = new Set(["topic1", "topic2", "topic3"]);

      const result = parseTitleRefineResponse(raw, validIds);
      expect(result).toHaveLength(1);
      expect(result[0].topicId).toBe("topic1");
    });

    it("throws when no valid entries remain", () => {
      const raw = JSON.stringify({
        titles: [{ id: "unknown", title: "タイトル" }],
      });
      const validIds = new Set(["topic1"]);

      expect(() => parseTitleRefineResponse(raw, validIds)).toThrow("有効なタイトル修正を作れません");
    });

    it("throws when response lacks titles array", () => {
      const raw = JSON.stringify({ data: [] });
      const validIds = new Set(["topic1"]);

      expect(() => parseTitleRefineResponse(raw, validIds)).toThrow("titles配列がありません");
    });

    it("throws on invalid JSON", () => {
      const validIds = new Set(["topic1"]);
      expect(() => parseTitleRefineResponse("not json", validIds)).toThrow();
    });
  });

  describe("refineTopicTitlesWithLlm", () => {
    it("returns empty array when candidates are empty", async () => {
      const settings: LlmSettings = { baseUrl: "http://localhost:8000", model: "test" };
      const mockChat = async () => '{"titles":[]}';

      const result = await refineTopicTitlesWithLlm(settings, [], mockChat);
      expect(result).toEqual([]);
    });

    it("calls chat with correct messages", async () => {
      const settings: LlmSettings = { baseUrl: "http://localhost:8000", model: "test" };
      let capturedMessages: any[] = [];
      const mockChat = async (_settings: any, messages: any[]) => {
        capturedMessages = messages;
        return JSON.stringify({ titles: [{ id: "topic1", title: "新タイトル" }] });
      };

      const candidates: TopicTitleCandidate[] = [
        {
          topicId: "topic1",
          currentTitle: "テスト",
          evidenceQuotes: ["証拠"],
        },
      ];

      await refineTopicTitlesWithLlm(settings, candidates, mockChat);
      expect(capturedMessages).toHaveLength(2);
      expect(capturedMessages[0].role).toBe("system");
      expect(capturedMessages[1].role).toBe("user");
    });

    it("throws when chat fails", async () => {
      const settings: LlmSettings = { baseUrl: "http://localhost:8000", model: "test" };
      const mockChat = async () => {
        throw new Error("Chat failed");
      };

      const candidates: TopicTitleCandidate[] = [
        { topicId: "topic1", currentTitle: "テスト", evidenceQuotes: [] },
      ];

      await expect(refineTopicTitlesWithLlm(settings, candidates, mockChat)).rejects.toThrow("Chat failed");
    });

    it("throws when parse fails", async () => {
      const settings: LlmSettings = { baseUrl: "http://localhost:8000", model: "test" };
      const mockChat = async () => "invalid json";

      const candidates: TopicTitleCandidate[] = [
        { topicId: "topic1", currentTitle: "テスト", evidenceQuotes: [] },
      ];

      await expect(refineTopicTitlesWithLlm(settings, candidates, mockChat)).rejects.toThrow();
    });
  });
});
