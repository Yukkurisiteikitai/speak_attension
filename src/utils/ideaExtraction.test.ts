import { describe, expect, it } from "vitest";
import { extractIdeaKeywords } from "./ideaExtraction";

describe("extractIdeaKeywords", () => {
  it("extracts content keywords from a brainstorm utterance", () => {
    const labels = extractIdeaKeywords("プッシュ通知とかリマインダーみたいな機能が欲しい").map((item) => item.label);

    expect(labels).toContain("プッシュ通知");
    expect(labels).toContain("リマインダー");
  });

  it("ignores filler utterances", () => {
    expect(extractIdeaKeywords("なるほど")).toEqual([]);
    expect(extractIdeaKeywords("そうですね")).toEqual([]);
  });

  it("drops generic brainstorm scaffolding words", () => {
    const labels = extractIdeaKeywords("いいアイデアだと思う").map((item) => item.label);

    expect(labels).not.toContain("アイデア");
  });

  it("deduplicates keywords within one utterance", () => {
    const labels = extractIdeaKeywords("通知。通知は大事").map((item) => item.label);

    expect(labels.filter((label) => label === "通知")).toHaveLength(1);
  });

  it("drops generic business filler words that would otherwise become noise keywords", () => {
    const labels = extractIdeaKeywords("料金モデル案について詳しく検討する必要がある").map((item) => item.label);

    expect(labels).not.toContain("検討");
    expect(labels).not.toContain("必要");
    expect(labels).toContain("料金モデル案");
  });
});
