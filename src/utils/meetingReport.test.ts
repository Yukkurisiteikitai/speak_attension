import { describe, expect, it } from "vitest";
import type { AnalyzedSegment } from "../types/topic";
import { buildMeetingReport, renderMeetingReportMarkdown } from "./meetingReport";
import { createInitialTopicEngineState, processTopicSegment, type TopicEngineState } from "./topicEngine";

function runScenario(texts: Array<[string, number]>): { state: TopicEngineState; segments: AnalyzedSegment[] } {
  let state = createInitialTopicEngineState(0);
  const segments: AnalyzedSegment[] = [];
  for (const [text, at] of texts) {
    const transition = processTopicSegment(state, text, "replay", at);
    state = transition.state;
    segments.push(transition.segment);
  }
  return { state, segments };
}

describe("buildMeetingReport", () => {
  it("reports missing decision and next action for a topic that was only mentioned", () => {
    const { state, segments } = runScenario([
      ["今日はレイテンシー対策について話します", 0],
      ["レイテンシー対策は方針を決定します", 5_000],
    ]);

    const report = buildMeetingReport({
      meetingGraph: state.meetingGraph,
      importantMentions: state.importantMentions,
      segments,
      now: 20_000,
    });

    const topicFindings = report.findings.filter((finding) => finding.kind === "topic_gap");
    expect(topicFindings.length).toBeGreaterThan(0);
    expect(topicFindings.some((finding) => finding.gapType === "missing_next_action")).toBe(true);
    expect(topicFindings.every((finding) => finding.topicTitle !== null)).toBe(true);
  });

  it("includes evidence text from the segment archive", () => {
    const { state, segments } = runScenario([
      ["予算計画の件を決めたいです", 0],
      ["予算計画は担当を田中さんが持ちます", 5_000],
    ]);

    const report = buildMeetingReport({
      meetingGraph: state.meetingGraph,
      importantMentions: state.importantMentions,
      segments,
      now: 20_000,
    });

    const withEvidence = report.findings.filter((finding) => finding.evidence.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);
    expect(withEvidence[0].evidence.join(" ")).toContain("予算計画");
  });

  it("sorts findings with high severity first and counts topics", () => {
    const { state, segments } = runScenario([
      ["認証フローの件ってどうしますか？", 0],
      ["次に運用体制の見直しについて話します", 16_000],
      ["運用体制の見直しで担当を決める", 22_000],
    ]);

    const report = buildMeetingReport({
      meetingGraph: state.meetingGraph,
      importantMentions: state.importantMentions,
      segments,
      now: 40_000,
    });

    expect(report.topicCount).toBeGreaterThanOrEqual(2);
    const weights = report.findings.map((finding) => (finding.severity === "high" ? 3 : finding.severity === "medium" ? 2 : 1));
    const sorted = [...weights].sort((a, b) => b - a);
    expect(weights).toEqual(sorted);
  });
});

describe("renderMeetingReportMarkdown", () => {
  it("renders headline, stats, and severity sections", () => {
    const { state, segments } = runScenario([
      ["今日はレイテンシー対策について話します", 0],
      ["別のリリース日程の件も決めます", 16_000],
    ]);

    const report = buildMeetingReport({
      meetingGraph: state.meetingGraph,
      importantMentions: state.importantMentions,
      segments,
      now: 40_000,
    });
    const markdown = renderMeetingReportMarkdown(report);

    expect(markdown).toContain("# 会議の抜け漏れレポート");
    expect(markdown).toContain("指摘件数");
    expect(markdown).toContain("## 高優先");
    expect(markdown).toContain("> ");
  });
});
