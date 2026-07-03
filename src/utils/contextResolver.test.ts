import { describe, expect, it } from "vitest";
import type { ConversationContext } from "../types/topic";
import { detectReferencePhrases, resolveReferences } from "./contextResolver";

const baseContext: ConversationContext = {
  activeTopicId: "latency",
  recentTopicIds: ["latency", "ui"],
  recentSegments: [
    {
      id: "seg-1",
      text: "速度とレイテンシが問題です",
      createdAt: 1,
      source: "manual",
      matchedTopicIds: ["latency"],
    },
  ],
};

describe("detectReferencePhrases", () => {
  it("detects Japanese pronouns and contextual phrases", () => {
    expect(detectReferencePhrases("それで、さっきの話に戻ると問題です")).toEqual(["さっきの話", "それで", "それ"]);
  });
});

describe("resolveReferences", () => {
  it("resolves direct pronouns to the active topic when context exists", () => {
    const references = resolveReferences("それが問題です", baseContext);
    expect(references[0]).toMatchObject({
      phrase: "それ",
      candidateTopicId: "latency",
    });
    expect(references[0].confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps references low-confidence when context is empty", () => {
    const references = resolveReferences("これをあとで見たい", {
      activeTopicId: null,
      recentTopicIds: [],
      recentSegments: [],
    });
    expect(references[0]).toMatchObject({
      phrase: "これ",
      candidateTopicId: null,
    });
    expect(references[0].confidence).toBeLessThan(0.6);
  });
});
