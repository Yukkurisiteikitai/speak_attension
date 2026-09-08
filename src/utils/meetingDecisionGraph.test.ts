import { describe, expect, it } from "vitest";
import type { AnalyzedSegment } from "../types/topic";
import {
  appendMeetingDecisionSegment,
  createInitialMeetingDecisionGraph,
  selectCurrentActions,
  traceDecisionGraphBackwards,
} from "./meetingDecisionGraph";

function segment(id: string, text: string, createdAt: number): AnalyzedSegment {
  return {
    id,
    text,
    createdAt,
    source: "manual",
    matchedTopicIds: [],
    analysis: {
      selectedTopicId: null,
      selectedTopicLabel: null,
      matchedTopicIds: [],
      intent: "unknown",
      focusRelation: "uncertain",
      focusAlignmentScore: 0,
      candidateTopicPhrases: [],
      topicScores: [],
      resolvedReferences: [],
      unresolvedReferences: [],
      shouldUpdateGraph: false,
      shouldUpdateCurrentTopic: false,
      shouldCreateNode: false,
      coverageUpdates: [],
      createdGapIds: [],
      reason: "test",
    },
  };
}

describe("meetingDecisionGraph", () => {
  it("builds a decided action with a backward path to the original evidence", () => {
    const texts = [
      "新バージョンにしてからエラー率が35%になっています",
      "新バージョンが原因かもしれない",
      "DBのwriteで3件壊れています",
      "このまま動かすと壊れたデータが増える",
      "一度v1.42に戻そう",
      "それでいこう。今すぐロールバック",
    ];
    const graph = texts.reduce(
      (current, text, index) => appendMeetingDecisionSegment(current, segment(`s${index + 1}`, text, 1_000 + index)),
      createInitialMeetingDecisionGraph(),
    );

    const [action] = selectCurrentActions(graph);
    expect(action).toMatchObject({
      type: "action",
      label: "v1.42へロールバック",
      state: "decided",
      action: {
        why: "データ破損を止める",
        whyNow: "稼働を続けるほど破損が増える",
        deadline: "即時",
        urgency: "critical",
        status: "decided",
      },
    });

    const trace = traceDecisionGraphBackwards(graph, action.id);
    expect(trace.map((node) => node.type)).toEqual(expect.arrayContaining(["action", "decision", "risk", "evidence", "utterance"]));
    expect(trace.filter((node) => node.type === "utterance").map((node) => node.label)).toEqual(
      expect.arrayContaining([texts[0], texts[2], texts[3]]),
    );
    expect(graph.nodes.find((node) => node.type === "reason")?.state).toBe("unconfirmed");
  });

  it("does not turn an unconfirmed human inference into a decision", () => {
    const graph = appendMeetingDecisionSegment(
      createInitialMeetingDecisionGraph(),
      segment("s1", "新バージョンが原因かもしれない", 1_000),
    );

    expect(graph.nodes.find((node) => node.type === "reason")).toMatchObject({ state: "unconfirmed" });
    expect(selectCurrentActions(graph)).toEqual([]);
  });
});
