import { describe, expect, it } from "vitest";
import type { MeetingReport, MeetingReportFinding } from "./meetingReport";
import { buildEvaluationDataset, summarizeFeedback } from "./reportFeedback";

function createFinding(id: string, overrides: Partial<MeetingReportFinding> = {}): MeetingReportFinding {
  return {
    id,
    kind: "topic_gap",
    gapType: "missing_decision",
    topicId: "topic-1",
    topicTitle: "レイテンシー対策",
    severity: "high",
    title: "決定不足",
    detail: "結論か未解決の明示がありません。",
    evidence: ["レイテンシー対策について話します"],
    ...overrides,
  };
}

function createReport(findings: MeetingReportFinding[]): MeetingReport {
  return {
    meetingId: "meeting-1",
    meetingTitle: "test meeting",
    generatedAt: 1_000,
    segmentCount: 4,
    topicCount: 2,
    decidedTopicCount: 1,
    findings,
  };
}

describe("summarizeFeedback", () => {
  it("counts verdicts and computes helpful rate over rated findings only", () => {
    const findings = [createFinding("a"), createFinding("b"), createFinding("c"), createFinding("d")];
    const summary = summarizeFeedback(findings, { a: "helpful", b: "helpful", c: "noise" });

    expect(summary.total).toBe(4);
    expect(summary.helpful).toBe(2);
    expect(summary.noise).toBe(1);
    expect(summary.unrated).toBe(1);
    expect(summary.helpfulRate).toBeCloseTo(2 / 3);
  });

  it("returns null helpful rate when nothing is rated", () => {
    const summary = summarizeFeedback([createFinding("a")], {});
    expect(summary.helpfulRate).toBeNull();
  });

  it("ignores feedback for findings that are not in the report", () => {
    const summary = summarizeFeedback([createFinding("a")], { stale: "noise", a: "helpful" });
    expect(summary.noise).toBe(0);
    expect(summary.helpful).toBe(1);
  });
});

describe("buildEvaluationDataset", () => {
  it("pairs each finding with its verdict and llm review", () => {
    const findings = [
      createFinding("a", { llm: { verdict: "confirm", reason: "証拠と整合" } }),
      createFinding("b"),
    ];
    const dataset = buildEvaluationDataset(createReport(findings), { a: "helpful" }, 2_000);

    expect(dataset.version).toBe(2);
    expect(dataset.exportedAt).toBe(2_000);
    expect(dataset.entries).toHaveLength(2);
    expect(dataset.entries[0]).toMatchObject({
      findingId: "a",
      verdict: "helpful",
      llmVerdict: "confirm",
      llmReason: "証拠と整合",
    });
    expect(dataset.entries[1]).toMatchObject({ findingId: "b", verdict: null, llmVerdict: null });
    expect(dataset.summary.helpful).toBe(1);
    expect(dataset.conversationRatings).toEqual([]);
  });

  it("includes conversation hierarchy ratings", () => {
    const dataset = buildEvaluationDataset(createReport([]), {}, 2_000, [
      {
        id: "conversation-seg-1",
        segmentId: "seg-1",
        parentId: null,
        role: "topic",
        label: "採用フローの短縮",
        originalText: "採用フローの短縮について決めます",
        createdAt: 1,
        source: "replay",
        rating: 1,
        manuallyAdjusted: false,
      },
    ]);
    expect(dataset.conversationRatings).toEqual([
      {
        id: "conversation-seg-1",
        segmentId: "seg-1",
        parentId: null,
        role: "topic",
        label: "採用フローの短縮",
        rating: 1,
      },
    ]);
  });
});
