import { describe, expect, it } from "vitest";
import type { TopicNode } from "../types/topic";
import { createEmptyCoverage } from "./topicCoverage";
import { extractTopicPhrases, scoreTopicMatch } from "./topicExtraction";

describe("topic extraction", () => {
  it("keeps repeated meeting topics stable by overlap", () => {
    const topic: TopicNode = {
      id: "topic-latency",
      title: "レイテンシー対策",
      aliases: ["レイテンシー", "遅延対策"],
      lifecycle: "discussed",
      displayStates: ["discussed"],
      coverage: createEmptyCoverage(),
      evidenceSegmentIds: [],
      mentionCount: 2,
      openQuestionCount: 0,
      firstSeenAt: 1,
      lastSeenAt: 2,
      lastActivatedAt: null,
      closedAt: 3,
      lastActivatedSegmentIndex: 1,
    };

    const score = scoreTopicMatch("レイテンシーの件を詰めたい", topic);

    expect(score.topicId).toBe("topic-latency");
    expect(score.score).toBeGreaterThanOrEqual(0.5);
  });

  it("does not create phrases from acknowledgements", () => {
    expect(extractTopicPhrases("そうですね")).toEqual([]);
  });
});
