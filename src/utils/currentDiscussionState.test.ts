import { describe, expect, it } from "vitest";
import type { AnalyzedSegment, MeetingDecisionGraph, TopicNode } from "../types/topic";
import { appendMeetingDecisionSegment, createInitialMeetingDecisionGraph } from "./meetingDecisionGraph";
import { buildCurrentDiscussionState, isWellFormedTopicTitle } from "./currentDiscussionState";
import { extractTopicPhrases } from "./topicExtraction";
import { createEmptyCoverage } from "./topicCoverage";

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

function topic(id: string, title: string, lastActivatedAt: number | null = 0): TopicNode {
  return {
    id,
    title,
    aliases: [],
    lifecycle: "active",
    displayStates: ["active"],
    coverage: createEmptyCoverage(),
    evidenceSegmentIds: [],
    mentionCount: 1,
    openQuestionCount: 0,
    firstSeenAt: 0,
    lastSeenAt: 0,
    lastActivatedAt,
    closedAt: null,
    lastActivatedSegmentIndex: 0,
  };
}

function graphFrom(texts: string[]): MeetingDecisionGraph {
  return texts.reduce(
    (state, text, index) => appendMeetingDecisionSegment(state, segment(`s${index}`, text, index * 1000)),
    createInitialMeetingDecisionGraph(),
  );
}

describe("buildCurrentDiscussionState", () => {
  it("reproduces the reported scenario: a real question is surfaced, no decision/action is invented, and the topic title is not a broken fragment", () => {
    const texts = [
      "問題のステップの修正はまだ完了してない。",
      "このステップが完了することは何を意味するか。",
      "その完了が意味するのは楽しみの完結である。",
    ];
    const decisionGraph = graphFrom(texts);
    const segments = texts.map((text, index) => segment(`s${index}`, text, index * 1000));

    // The topic engine would extract a phrase from the first sentence; verify
    // the extraction itself is not a broken particle-led fragment (regression
    // for the "のステップの修正" bug), then feed it in as the current topic.
    const phrase = extractTopicPhrases(texts[0])[0]?.phrase ?? "";
    expect(isWellFormedTopicTitle(phrase)).toBe(true);
    const meetingGraph = { nodes: [topic("t1", phrase, 0)] };

    const state = buildCurrentDiscussionState(meetingGraph, "t1", decisionGraph, segments);

    expect(state.topicTitle).not.toMatch(/^[のをがはにでともへ]/);
    expect(state.stage).toBe("resolving_question");
    expect(state.unresolvedQuestion?.label).toContain("完了することは何を意味するか");
    expect(state.counts.confirmedDecisions).toBe(0);
    expect(state.counts.nextActions).toBe(0);
    expect(decisionGraph.nodes.some((node) => node.type === "decision")).toBe(false);
    expect(decisionGraph.nodes.some((node) => node.type === "action")).toBe(false);
    expect(state.progressCondition).toContain("完了することは何を意味するか");
  });

  it("falls back to the unresolved question's own text when the extracted topic title is broken", () => {
    const decisionGraph = graphFrom(["このステップが完了することは何を意味するか。"]);
    const segments = [segment("s0", "このステップが完了することは何を意味するか。", 0)];
    // A deliberately broken topic title (as if extraction produced a fragment).
    const meetingGraph = { nodes: [topic("t1", "のステップの修正", 0)] };

    const state = buildCurrentDiscussionState(meetingGraph, "t1", decisionGraph, segments);
    expect(state.topicTitleSource).toBe("unresolved_question");
    expect(state.topicTitle).not.toMatch(/^[のをがはにでともへ]/);
  });

  it("falls back to the most recent utterance when there is no topic and no unresolved question", () => {
    const decisionGraph = graphFrom(["資料を作成します"]);
    const segments = [segment("s0", "資料を作成します", 0)];
    const state = buildCurrentDiscussionState(null, null, decisionGraph, segments);
    expect(state.topicTitleSource).toBe("recent_utterance");
    expect(state.topicTitle).toContain("資料を作成します");
  });

  it("reports 'unknown' when there is nothing at all", () => {
    const state = buildCurrentDiscussionState(null, null, createInitialMeetingDecisionGraph(), []);
    expect(state.topicTitleSource).toBe("unknown");
    expect(state.stage).toBe("unknown");
  });

  it("stage: a single problem with no reason yet is 'confirming_problem'", () => {
    const decisionGraph = graphFrom(["これは課題です"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("confirming_problem");
  });

  it("stage: a problem with a reason is 'organizing_reasons'", () => {
    const decisionGraph = graphFrom(["これは課題です", "遅れているので問題です"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(["organizing_reasons", "confirming_problem"]).toContain(state.stage);
  });

  it("stage: exactly one proposal with no decision is 'generating_options'", () => {
    const decisionGraph = graphFrom(["資料を作成しましょう"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("generating_options");
  });

  it("stage: two distinct named proposals with no decision is 'comparing_options'", () => {
    const decisionGraph = graphFrom(["A案でメールを自動化しましょう", "B案で電話を増やしましょう"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("comparing_options");
  });

  it("stage: a decision with no action yet is 'decided' with a progress condition about the next action", () => {
    // "それでいこう" alone (no prior proposal, no action verb) creates a
    // decision without an action -- see appendMeetingDecisionSegment's action
    // creation gate.
    const decisionGraph = graphFrom(["それでいこう"]);
    expect(decisionGraph.nodes.some((n) => n.type === "decision")).toBe(true);
    expect(decisionGraph.nodes.some((n) => n.type === "action")).toBe(false);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("decided");
    expect(state.progressCondition).toContain("アクション");
    expect(state.decisionThemeTitle).toBe(state.topicTitle);
  });

  it("decisionThemeTitle is null when there is no decision in scope yet (exploration, not judgement)", () => {
    const decisionGraph = graphFrom(["これは課題です"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("confirming_problem");
    expect(state.decisionThemeTitle).toBeNull();
  });

  it("stage: an action missing owner/deadline is 'clarifying_execution'", () => {
    const decisionGraph = graphFrom(["対応します"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("clarifying_execution");
  });

  it("stage: an action with owner and deadline is 'decided'", () => {
    const decisionGraph = graphFrom(["田中さんが明日までに資料を作成します"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("decided");
  });

  it("an unresolved question always takes priority over an existing decision/action", () => {
    const decisionGraph = graphFrom(["田中さんが明日までに資料を作成します", "この方針で本当によいのでしょうか"]);
    const state = buildCurrentDiscussionState(null, null, decisionGraph, []);
    expect(state.stage).toBe("resolving_question");
  });

  it("scopes to nodes created since the current topic became active, ignoring earlier unrelated activity", () => {
    const decisionGraph = graphFrom(["これは課題です", "資料を作成しましょう"]);
    // Topic became active only at the second segment's time (1000) or later.
    const meetingGraph = { nodes: [topic("t1", "新しい論点", 1000)] };
    const state = buildCurrentDiscussionState(meetingGraph, "t1", decisionGraph, []);
    expect(state.stage).toBe("generating_options");
    expect(state.counts.confirmedDecisions).toBe(0);
  });
});
