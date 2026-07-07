import { describe, expect, it } from "vitest";
import { buildReaderGuide } from "./readerGuide";
import type { AnalyzedSegment, FocusState, TopicGap, TopicNode } from "../types/topic";
import { createEmptyCoverage } from "./topicCoverage";

function createTopic(): TopicNode {
  return {
    id: "topic-1",
    title: "認証フロー",
    aliases: [],
    lifecycle: "active",
    displayStates: ["active"],
    coverage: createEmptyCoverage(),
    evidenceSegmentIds: [],
    mentionCount: 2,
    openQuestionCount: 0,
    firstSeenAt: 0,
    lastSeenAt: 0,
    lastActivatedAt: 0,
    closedAt: null,
    lastActivatedSegmentIndex: 1,
  };
}

function createFocusState(): FocusState {
  return {
    focusTopicId: "topic-1",
    focusLabel: "認証フロー",
    focusSetBy: "auto",
    locked: false,
    startedAt: 0,
  };
}

function createSegment(): AnalyzedSegment {
  return {
    id: "seg-1",
    text: "これって誰がやるんでしたっけ",
    createdAt: 0,
    source: "manual",
    matchedTopicIds: ["topic-1"],
    analysis: {
      selectedTopicId: "topic-1",
      selectedTopicLabel: "認証フロー",
      matchedTopicIds: ["topic-1"],
      intent: "question",
      focusRelation: "on_focus",
      focusAlignmentScore: 1,
      candidateTopicPhrases: [],
      topicScores: [],
      resolvedReferences: [],
      unresolvedReferences: ["これ"],
      shouldUpdateGraph: true,
      shouldUpdateCurrentTopic: true,
      shouldCreateNode: false,
      coverageUpdates: [],
      createdGapIds: [],
      reason: "matched against existing meeting topic",
    },
  };
}

describe("buildReaderGuide", () => {
  it("explains the empty state to first-time readers", () => {
    const guide = buildReaderGuide({
      currentTopic: null,
      currentTopicGaps: [],
      focusState: createFocusState(),
      latestSegment: null,
    });

    expect(guide.summary).toContain("まだ会話が入っていない");
    expect(guide.unknowns[0]).toContain("確定できていません");
  });

  it("surfaces unresolved references and current gaps", () => {
    const gaps: TopicGap[] = [
      {
        id: "gap-1",
        topicId: "topic-1",
        type: "missing_owner",
        title: "担当不足",
        detail: "次アクションに担当が紐付いていません。",
        severity: "high",
        createdAt: 0,
        closedAt: null,
      },
    ];

    const guide = buildReaderGuide({
      currentTopic: createTopic(),
      currentTopicGaps: gaps,
      focusState: createFocusState(),
      latestSegment: createSegment(),
    });

    expect(guide.summary).toContain("認証フロー");
    expect(guide.unknowns.some((item) => item.includes("「これ」"))).toBe(true);
    expect(guide.unknowns.some((item) => item.includes("担当不足"))).toBe(true);
    expect(guide.hints.some((item) => item.includes("Coverage"))).toBe(true);
  });
});
