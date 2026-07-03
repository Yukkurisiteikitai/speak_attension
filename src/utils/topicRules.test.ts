import { describe, expect, it } from "vitest";
import type { FocusState } from "../types/topic";
import { INITIAL_TOPIC_NODES, findMatchedKeywords, scoreTopic, scoreTopicBreakdown, sortTopicScores } from "./topicRules";

const focusState: FocusState = {
  focusTopicId: null,
  focusLabel: null,
  focusSetBy: "auto",
  locked: false,
  startedAt: 1,
};

describe("topicRules", () => {
  it("scores topic nodes by matched keywords", () => {
    const graphNode = INITIAL_TOPIC_NODES.find((node) => node.id === "graph");
    expect(graphNode).toBeDefined();
    expect(scoreTopic("React Flowのノードとエッジを描画します", graphNode!)).toBe(4);
  });

  it("returns matched keywords for decision logs", () => {
    const uiNode = INITIAL_TOPIC_NODES.find((node) => node.id === "ui");
    expect(uiNode).toBeDefined();
    expect(findMatchedKeywords("画面で強調してLive感を出したい", uiNode!)).toEqual(["画面", "Live感", "強調"]);
  });

  it("scores latency synonyms separately from keywords", () => {
    const latencyNode = INITIAL_TOPIC_NODES.find((node) => node.id === "latency");
    expect(latencyNode).toBeDefined();

    const score = scoreTopicBreakdown({
      text: "待ち時間とラグがあって、画面の反応も重いです",
      node: latencyNode!,
      focusState,
      intent: "concern",
      now: 1,
    });

    expect(score.keywordScore).toBe(0);
    expect(score.synonymScore).toBeGreaterThan(0);
    expect(score.matchedSynonyms).toEqual(["待ち時間", "反応", "ラグ", "重い"]);
  });

  it("sorts topic score breakdowns deterministically", () => {
    const sorted = sortTopicScores([
      { index: 1, total: 1, keywordScore: 1, synonymScore: 0 },
      { index: 2, total: 1.7, keywordScore: 1, synonymScore: 0.7 },
      { index: 0, total: 1.7, keywordScore: 1, synonymScore: 0.7 },
    ]);

    expect(sorted.map((score) => score.index)).toEqual([0, 2, 1]);
  });
});
