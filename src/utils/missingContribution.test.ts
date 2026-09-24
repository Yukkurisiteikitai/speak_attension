import { describe, expect, it } from "vitest";
import type { MeetingDecisionGraph, TopicGap, TopicNode } from "../types/topic";
import { buildMissingContributions } from "./missingContribution";

const topic: TopicNode = { id: "topic-1", title: "ロールバック", aliases: [], lifecycle: "active", displayStates: ["active"], coverage: { decision: true, reason: false, owner: false, dueDate: false, risk: false, alternative: false, objection: false, nextAction: true, dependency: false, openQuestionResolved: false }, evidenceSegmentIds: ["s1"], mentionCount: 2, openQuestionCount: 0, firstSeenAt: 1, lastSeenAt: 1, lastActivatedAt: 1, closedAt: null, lastActivatedSegmentIndex: 1 };
const gap = (type: TopicGap["type"], severity: TopicGap["severity"]): TopicGap => ({ id: type, topicId: topic.id, type, title: type, detail: type + " の確認が必要です。", severity, createdAt: 1, closedAt: null });
const graph: MeetingDecisionGraph = { nodes: [{ id: "action-s1", type: "action", label: "v1.42へロールバック", state: "decided", provenance: { utteranceIds: ["s1"], createdBy: "human" }, createdAt: 1, action: { what: "v1.42へロールバック", status: "decided" } }], edges: [] };

describe("buildMissingContributions", () => {
  it("checks each action even when another action filled topic-wide coverage", () => {
    const complete = { ...graph.nodes[0], id: "complete", action: { what: "調査", owner: "佐野", deadline: "今日", why: "原因確認", status: "decided" as const } };
    const coveredTopic = { ...topic, coverage: { ...topic.coverage, owner: true, dueDate: true, reason: true } };
    const result = buildMissingContributions({ gaps: [], topics: [coveredTopic], decisionGraph: { nodes: [complete, ...graph.nodes], edges: [] }, segments: [], currentTopicId: topic.id });
    expect(result.filter((item) => item.relatedActionId === "action-s1").map((item) => item.kind)).toEqual(expect.arrayContaining(["missing_owner", "missing_due_date", "missing_reason"]));
    expect(result.filter((item) => item.relatedActionId === "complete" && ["missing_owner", "missing_due_date", "missing_reason"].includes(item.kind))).toEqual([]);
  });

  it("does not require a matching extracted topic to expose action gaps", () => {
    const result = buildMissingContributions({ gaps: [], topics: [], decisionGraph: graph, segments: [], currentTopicId: null });
    expect(result).toHaveLength(3);
    expect(result.every((item) => item.relatedActionId === "action-s1")).toBe(true);
  });

  it("does not reuse stale topic gaps for completed action fields or treat AI suggestions as decisions", () => {
    const complete = { ...graph.nodes[0], action: { what: "対応", owner: "佐野", deadline: "即時", why: "破損防止", status: "decided" as const } };
    const result = buildMissingContributions({ gaps: [gap("missing_owner", "high"), gap("missing_due_date", "medium")], topics: [topic], decisionGraph: { nodes: [complete], edges: [] }, segments: [], currentTopicId: topic.id });
    expect(result).toEqual([]);
    expect(buildMissingContributions({ gaps: [], topics: [], decisionGraph: { nodes: [{ ...graph.nodes[0], state: "unconfirmed" }], edges: [] }, segments: [], currentTopicId: null })).toEqual([]);
  });

  it("derives cards for an active topic even before its gaps are persisted", () => {
    const contributions = buildMissingContributions({ gaps: [], topics: [topic], decisionGraph: graph, segments: [], currentTopicId: topic.id });
    expect(contributions.map((item) => item.kind)).toEqual(expect.arrayContaining(["missing_reason", "missing_owner", "missing_due_date"]));
  });

  it("turns owner and deadline gaps into action-specific questions without duplicate evidence", () => {
    const contributions = buildMissingContributions({ gaps: [gap("missing_due_date", "medium"), gap("missing_owner", "high")], topics: [topic], decisionGraph: graph, segments: [], currentTopicId: topic.id });
    expect(contributions.map((item) => item.question)).toEqual(expect.arrayContaining(["v1.42へロールバックは誰が担当しますか？", "v1.42へロールバックはいつまでに完了または進捗確認しますか？"]));
    expect(contributions[0].kind).toBe("missing_owner");
    expect(contributions.every((item) => new Set(item.evidenceSegmentIds).size === item.evidenceSegmentIds.length)).toBe(true);
  });
});
