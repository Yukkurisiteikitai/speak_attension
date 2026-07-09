import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./llmClient";
import { buildGapReviewPrompt, parseGapReviewResponse, reviewReportWithLlm } from "./llmGapReview";
import type { MeetingReport, MeetingReportFinding } from "./meetingReport";

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

const SETTINGS = { baseUrl: "http://127.0.0.1:1234/v1", model: "test-model" };

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"findings": []}')).toEqual({ findings: [] });
  });

  it("strips code fences and surrounding prose", () => {
    const raw = '判定結果です。\n```json\n{"findings": [{"id": "a", "verdict": "confirm"}]}\n```';
    expect(extractJsonObject(raw)).toEqual({ findings: [{ id: "a", verdict: "confirm" }] });
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractJsonObject("判定できません")).toThrow();
  });
});

describe("parseGapReviewResponse", () => {
  it("keeps only known finding ids with valid verdicts", () => {
    const raw = JSON.stringify({
      findings: [
        { id: "a", verdict: "confirm", reason: "証拠と整合" },
        { id: "unknown", verdict: "drop", reason: "対象外" },
        { id: "b", verdict: "maybe", reason: "無効な判定" },
      ],
      additional: [{ title: "コスト確認不足", detail: "コストの話が出たまま流れています。", severity: "high" }],
    });

    const parsed = parseGapReviewResponse(raw, new Set(["a", "b"]));

    expect(parsed.reviews.size).toBe(1);
    expect(parsed.reviews.get("a")).toEqual({ verdict: "confirm", reason: "証拠と整合" });
    expect(parsed.additional).toEqual([
      { title: "コスト確認不足", detail: "コストの話が出たまま流れています。", severity: "high" },
    ]);
  });

  it("defaults additional severity to medium when invalid", () => {
    const raw = JSON.stringify({ findings: [], additional: [{ title: "追加指摘", detail: "", severity: "urgent" }] });
    const parsed = parseGapReviewResponse(raw, new Set());
    expect(parsed.additional[0].severity).toBe("medium");
  });
});

describe("buildGapReviewPrompt", () => {
  it("includes topic title, evidence, and finding ids", () => {
    const prompt = buildGapReviewPrompt({
      topicId: "topic-1",
      topicTitle: "レイテンシー対策",
      findings: [createFinding("topic-1-missing_decision")],
    });

    expect(prompt).toContain("レイテンシー対策");
    expect(prompt).toContain("topic-1-missing_decision");
    expect(prompt).toContain("レイテンシー対策について話します");
  });
});

describe("reviewReportWithLlm", () => {
  it("annotates findings per topic group and appends llm_added findings", async () => {
    const report = createReport([
      createFinding("topic-1-missing_decision"),
      createFinding("topic-2-missing_owner", { topicId: "topic-2", topicTitle: "予算計画", gapType: "missing_owner" }),
    ]);

    const result = await reviewReportWithLlm(report, SETTINGS, async (_settings, messages) => {
      const prompt = messages[1].content;
      if (prompt.includes("topic-1-missing_decision")) {
        return JSON.stringify({
          findings: [{ id: "topic-1-missing_decision", verdict: "drop", reason: "決定は明言されている" }],
          additional: [],
        });
      }
      return JSON.stringify({
        findings: [{ id: "topic-2-missing_owner", verdict: "confirm", reason: "担当者の言及なし" }],
        additional: [{ title: "予算上限の確認不足", detail: "上限額が未確認です。", severity: "medium" }],
      });
    });

    expect(result.errors).toEqual([]);
    expect(result.reviewedGroupCount).toBe(2);
    expect(result.findings.find((finding) => finding.id === "topic-1-missing_decision")?.llm?.verdict).toBe("drop");
    expect(result.findings.find((finding) => finding.id === "topic-2-missing_owner")?.llm?.verdict).toBe("confirm");
    const added = result.findings.filter((finding) => finding.kind === "llm_added");
    expect(added).toHaveLength(1);
    expect(added[0].topicId).toBe("topic-2");
  });

  it("keeps rule-based findings untouched when a group request fails", async () => {
    const report = createReport([createFinding("topic-1-missing_decision")]);

    const result = await reviewReportWithLlm(report, SETTINGS, async () => {
      throw new Error("connection refused");
    });

    expect(result.reviewedGroupCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].llm).toBeUndefined();
  });
});
