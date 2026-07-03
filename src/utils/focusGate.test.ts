import { describe, expect, it } from "vitest";
import type { FocusState, ResolvedReference } from "../types/topic";
import { INITIAL_TOPIC_EDGES, INITIAL_TOPIC_NODES, scoreTopicBreakdown, sortTopicScores } from "./topicRules";
import { evaluateFocusGate } from "./focusGate";
import { detectUtteranceIntent } from "./intentRules";

const focusedOnLatency: FocusState = {
  focusTopicId: "latency",
  focusLabel: "速度",
  focusSetBy: "auto",
  locked: false,
  startedAt: 1,
};

function gate(input: {
  text: string;
  focusState?: FocusState;
  selectedTopicId: string | null;
  matchedTopicIds: string[];
  resolvedReferences?: ResolvedReference[];
  unresolvedReferences?: string[];
}) {
  const focusState = input.focusState ?? focusedOnLatency;
  const intent = detectUtteranceIntent(input.text);
  const topicScores = sortTopicScores(
    INITIAL_TOPIC_NODES.map((node, index) => ({
      ...scoreTopicBreakdown({
        text: input.text,
        node,
        focusState,
        intent,
        now: 1,
      }),
      index,
    })),
  )
    .filter((score) => score.total > 0)
    .map(({ index: _index, ...score }) => score);

  return evaluateFocusGate({
    text: input.text,
    focusState,
    intent,
    selectedTopicId: input.selectedTopicId,
    matchedTopicIds: input.matchedTopicIds,
    topicScores,
    resolvedReferences: input.resolvedReferences ?? [],
    unresolvedReferences: input.unresolvedReferences ?? [],
    edges: INITIAL_TOPIC_EDGES,
    nodes: INITIAL_TOPIC_NODES,
  });
}

describe("evaluateFocusGate", () => {
  it("keeps latency utterances on focus", () => {
    expect(
      gate({
        text: "それで、さっきの話に戻ると遅延が問題です",
        selectedTopicId: "latency",
        matchedTopicIds: ["latency"],
      }).focusRelation,
    ).toBe("on_focus");
  });

  it("treats UI mentions as adjacent to latency focus", () => {
    expect(
      gate({
        text: "UIのLive感にも関係します",
        selectedTopicId: "ui",
        matchedTopicIds: ["ui"],
      }).focusRelation,
    ).toBe("adjacent");
  });

  it("keeps important off-focus cost utterances from taking current topic", () => {
    expect(
      gate({
        text: "ただ、コストも後で見た方がいいです",
        selectedTopicId: "cost",
        matchedTopicIds: ["cost"],
      }).focusRelation,
    ).toBe("off_topic_important");
  });

  it("classifies short acknowledgements as noise", () => {
    expect(
      gate({
        text: "そうですね",
        selectedTopicId: null,
        matchedTopicIds: [],
      }).focusRelation,
    ).toBe("off_topic_noise");
  });

  it("does not change locked focus when cost is mentioned", () => {
    const result = gate({
      text: "コストも高いですね",
      focusState: { ...focusedOnLatency, locked: true },
      selectedTopicId: "cost",
      matchedTopicIds: ["cost"],
    });

    expect(result.shouldChangeFocus).toBe(false);
    expect(result.focusChangeCandidateTopicId).toBeNull();
  });

  it("auto-changes focus only for explicit switch topic with strong direct match", () => {
    const result = gate({
      text: "話を戻すとコストの料金が高いです",
      selectedTopicId: "cost",
      matchedTopicIds: ["cost"],
    });

    expect(result.focusRelation).toBe("on_focus");
    expect(result.shouldChangeFocus).toBe(true);
    expect(result.focusChangeCandidateTopicId).toBe("cost");
  });

  it("does not change focus for agreement", () => {
    const result = gate({
      text: "そうですね",
      selectedTopicId: null,
      matchedTopicIds: [],
    });

    expect(result.focusRelation).toBe("off_topic_noise");
    expect(result.shouldChangeFocus).toBe(false);
  });

  it("classifies off-focus concern as important without changing focus", () => {
    const result = gate({
      text: "コストが問題になりそうです",
      selectedTopicId: "cost",
      matchedTopicIds: ["cost"],
    });

    expect(result.focusRelation).toBe("off_topic_important");
    expect(result.shouldChangeFocus).toBe(false);
  });
});
