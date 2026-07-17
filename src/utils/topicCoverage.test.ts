import { describe, expect, it } from "vitest";
import type { TopicNode } from "../types/topic";
import { buildTopicGaps, createEmptyCoverage, deriveDisplayStates, detectCoverageUpdates } from "./topicCoverage";

describe("coverage detection", () => {
  it("sets decision, reason, owner, dueDate, nextAction and risk markers", () => {
    const updates = detectCoverageUpdates("この方針で決定します。理由はコスト削減のためで、田中さんが来週までに対応する。リスクも確認する。");
    expect(updates.map((item) => item.key)).toEqual(
      expect.arrayContaining(["decision", "reason", "owner", "dueDate", "nextAction", "risk"]),
    );
  });
});

describe("closure and gaps", () => {
  it("marks shallow topics and missing items", () => {
    const topic: TopicNode = {
      id: "topic-a",
      title: "API契約",
      aliases: ["api契約"],
      lifecycle: "discussed",
      displayStates: ["discussed"],
      coverage: {
        ...createEmptyCoverage(),
        decision: true,
      },
      evidenceSegmentIds: ["seg-1"],
      mentionCount: 1,
      openQuestionCount: 0,
      firstSeenAt: 1,
      lastSeenAt: 2,
      lastActivatedAt: null,
      closedAt: 3,
      lastActivatedSegmentIndex: 1,
    };

    const gaps = buildTopicGaps(topic, false, 10);
    const types = gaps.map((gap) => gap.type);

    expect(types).toContain("shallow");
    expect(types).toContain("missing_reason");
    expect(types).toContain("missing_next_action");
  });

  it("exposes unresolved and missing display states when open questions remain", () => {
    const topic: TopicNode = {
      id: "topic-b",
      title: "認証フロー",
      aliases: ["認証フロー"],
      lifecycle: "unresolved",
      displayStates: ["discussed"],
      coverage: createEmptyCoverage(),
      evidenceSegmentIds: ["seg-2"],
      mentionCount: 1,
      openQuestionCount: 1,
      firstSeenAt: 1,
      lastSeenAt: 2,
      lastActivatedAt: null,
      closedAt: 3,
      lastActivatedSegmentIndex: 1,
    };

    const gaps = buildTopicGaps(topic, true, 10);
    const displayStates = deriveDisplayStates(topic, gaps, true);

    expect(displayStates).toContain("discussed");
    expect(displayStates).toContain("unresolved");
    expect(displayStates).toContain("missing");
    expect(displayStates).toContain("shallow");
  });
});
