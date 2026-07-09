import type {
  AnalyzedSegment,
  ImportantMention,
  MeetingGraph,
  TopicGapSeverity,
  TopicGapType,
  TopicNode,
} from "../types/topic";
import { buildTopicGaps } from "./topicCoverage";

export type MeetingReportFindingKind = "topic_gap" | "important_mention" | "llm_added";

export type LlmFindingReview = {
  verdict: "confirm" | "drop";
  reason: string;
};

export type MeetingReportFinding = {
  id: string;
  kind: MeetingReportFindingKind;
  gapType: TopicGapType | null;
  topicId: string | null;
  topicTitle: string | null;
  severity: TopicGapSeverity;
  title: string;
  detail: string;
  evidence: string[];
  llm?: LlmFindingReview;
};

export type MeetingReport = {
  meetingId: string;
  meetingTitle: string;
  generatedAt: number;
  segmentCount: number;
  topicCount: number;
  decidedTopicCount: number;
  findings: MeetingReportFinding[];
};

export type BuildMeetingReportInput = {
  meetingGraph: MeetingGraph;
  importantMentions: ImportantMention[];
  segments: AnalyzedSegment[];
  now?: number;
};

const MENTION_TYPE_LABELS: Record<ImportantMention["type"], string> = {
  problem: "問題提起",
  risk: "リスク指摘",
  todo: "TODO",
  decision: "決定発言",
  question: "疑問",
};

const EVIDENCE_LIMIT = 3;

function severityWeight(severity: TopicGapSeverity): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function hasUnresolvedQuestion(node: TopicNode): boolean {
  return node.openQuestionCount > 0 && !node.coverage.openQuestionResolved;
}

function collectEvidence(node: TopicNode, segmentTextById: Map<string, string>): string[] {
  return node.evidenceSegmentIds
    .map((segmentId) => segmentTextById.get(segmentId))
    .filter((text): text is string => Boolean(text))
    .slice(-EVIDENCE_LIMIT);
}

// Builds the post-meeting missing-items report by re-deriving gaps for every topic,
// so topics that were still active at the end of the meeting are also finalized.
export function buildMeetingReport(input: BuildMeetingReportInput): MeetingReport {
  const { meetingGraph, importantMentions, segments } = input;
  const now = input.now ?? Date.now();
  const segmentTextById = new Map(segments.map((segment) => [segment.id, segment.text]));
  const findings: MeetingReportFinding[] = [];

  const topics = meetingGraph.nodes.filter((node) => node.id !== meetingGraph.rootTopicId);

  for (const topic of topics) {
    const gaps = buildTopicGaps(topic, hasUnresolvedQuestion(topic), now);
    const evidence = collectEvidence(topic, segmentTextById);
    for (const gap of gaps) {
      findings.push({
        id: `${topic.id}-${gap.type}`,
        kind: "topic_gap",
        gapType: gap.type,
        topicId: topic.id,
        topicTitle: topic.title,
        severity: gap.severity,
        title: gap.title,
        detail: gap.detail,
        evidence,
      });
    }
  }

  for (const mention of importantMentions) {
    if (mention.relatedTopicId) continue;
    findings.push({
      id: `mention-${mention.segmentId}-${mention.type}`,
      kind: "important_mention",
      gapType: null,
      topicId: null,
      topicTitle: null,
      severity: mention.type === "todo" || mention.type === "decision" ? "high" : "medium",
      title: `未回収の${MENTION_TYPE_LABELS[mention.type]}`,
      detail: "どのトピックにも紐付かないまま流れた発言です。回収が必要か確認してください。",
      evidence: [mention.text],
    });
  }

  findings.sort((left, right) => {
    return (
      severityWeight(right.severity) - severityWeight(left.severity) ||
      (left.topicTitle ?? "").localeCompare(right.topicTitle ?? "", "ja-JP") ||
      left.title.localeCompare(right.title, "ja-JP")
    );
  });

  return {
    meetingId: meetingGraph.meetingId,
    meetingTitle: meetingGraph.title,
    generatedAt: now,
    segmentCount: segments.length,
    topicCount: topics.length,
    decidedTopicCount: topics.filter((topic) => topic.coverage.decision).length,
    findings,
  };
}

function severityLabel(severity: TopicGapSeverity): string {
  switch (severity) {
    case "high":
      return "高優先";
    case "medium":
      return "中優先";
    case "low":
      return "低優先";
  }
}

function renderFinding(finding: MeetingReportFinding): string {
  const lines: string[] = [];
  const scope = finding.topicTitle ? `【${finding.topicTitle}】` : "【トピック未紐付】";
  lines.push(`### ${scope} ${finding.title}`);
  lines.push("");
  lines.push(finding.detail);
  if (finding.llm) {
    lines.push("");
    lines.push(
      finding.llm.verdict === "confirm"
        ? `- LLM判定: 妥当 — ${finding.llm.reason}`
        : `- LLM判定: 除外候補 — ${finding.llm.reason}`,
    );
  }
  if (finding.evidence.length > 0) {
    lines.push("");
    finding.evidence.forEach((text) => lines.push(`> ${text}`));
  }
  return lines.join("\n");
}

export function renderMeetingReportMarkdown(report: MeetingReport): string {
  const lines: string[] = [];
  lines.push(`# 会議の抜け漏れレポート: ${report.meetingTitle}`);
  lines.push("");
  lines.push(`- 生成日時: ${new Date(report.generatedAt).toLocaleString("ja-JP")}`);
  lines.push(`- セグメント数: ${report.segmentCount}`);
  lines.push(`- トピック数: ${report.topicCount} (決定済み ${report.decidedTopicCount})`);
  lines.push(`- 指摘件数: ${report.findings.length}`);

  const severities: TopicGapSeverity[] = ["high", "medium", "low"];
  for (const severity of severities) {
    const group = report.findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push("");
    lines.push(`## ${severityLabel(severity)} (${group.length}件)`);
    for (const finding of group) {
      lines.push("");
      lines.push(renderFinding(finding));
    }
  }

  if (report.findings.length === 0) {
    lines.push("");
    lines.push("指摘事項はありません。");
  }

  lines.push("");
  return lines.join("\n");
}
