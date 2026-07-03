import { describe, expect, it } from "vitest";
import type { FocusState, ResolvedReference } from "../types/topic";
import { INITIAL_TOPIC_EDGES, INITIAL_TOPIC_NODES } from "./topicRules";
import { evaluateFocusGate } from "./focusGate";

const focusedOnLatency: FocusState = {
  focusTopicId: "latency",
  focusLabel: "速度",
  focusSetBy: "auto",
  startedAt: 1,
};

function gate(input: {
  text: string;
  selectedTopicId: string | null;
  matchedTopicIds: string[];
  resolvedReferences?: ResolvedReference[];
  unresolvedReferences?: string[];
}) {
  return evaluateFocusGate({
    text: input.text,
    focusState: focusedOnLatency,
    selectedTopicId: input.selectedTopicId,
    matchedTopicIds: input.matchedTopicIds,
    resolvedReferences: input.resolvedReferences ?? [],
    unresolvedReferences: input.unresolvedReferences ?? [],
    edges: INITIAL_TOPIC_EDGES,
    nodes: INITIAL_TOPIC_NODES,
  }).focusRelation;
}

describe("evaluateFocusGate", () => {
  it("keeps latency utterances on focus", () => {
    expect(
      gate({
        text: "それで、さっきの話に戻ると遅延が問題です",
        selectedTopicId: "latency",
        matchedTopicIds: ["latency"],
      }),
    ).toBe("on_focus");
  });

  it("treats UI mentions as adjacent to latency focus", () => {
    expect(
      gate({
        text: "UIのLive感にも関係します",
        selectedTopicId: "ui",
        matchedTopicIds: ["ui"],
      }),
    ).toBe("adjacent");
  });

  it("keeps important off-focus cost utterances from taking current topic", () => {
    expect(
      gate({
        text: "ただ、コストも後で見た方がいいです",
        selectedTopicId: "cost",
        matchedTopicIds: ["cost"],
      }),
    ).toBe("off_topic_important");
  });

  it("classifies short acknowledgements as noise", () => {
    expect(
      gate({
        text: "そうですね",
        selectedTopicId: null,
        matchedTopicIds: [],
      }),
    ).toBe("off_topic_noise");
  });
});
