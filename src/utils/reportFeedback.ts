import type { MeetingReport, MeetingReportFinding } from "./meetingReport";

export type FindingVerdict = "helpful" | "noise";

export type ReportFeedbackMap = Record<string, FindingVerdict>;

export type FeedbackSummary = {
  total: number;
  helpful: number;
  noise: number;
  unrated: number;
  helpfulRate: number | null;
};

export type EvaluationDatasetEntry = {
  findingId: string;
  kind: MeetingReportFinding["kind"];
  gapType: MeetingReportFinding["gapType"];
  topicTitle: string | null;
  severity: MeetingReportFinding["severity"];
  title: string;
  detail: string;
  evidence: string[];
  verdict: FindingVerdict | null;
  llmVerdict: "confirm" | "drop" | null;
  llmReason: string | null;
};

export type EvaluationDataset = {
  version: 1;
  meetingId: string;
  meetingTitle: string;
  reportGeneratedAt: number;
  exportedAt: number;
  summary: FeedbackSummary;
  entries: EvaluationDatasetEntry[];
};

// helpfulRate is the precision proxy: rated-helpful over all rated findings.
export function summarizeFeedback(findings: MeetingReportFinding[], feedback: ReportFeedbackMap): FeedbackSummary {
  let helpful = 0;
  let noise = 0;
  for (const finding of findings) {
    const verdict = feedback[finding.id];
    if (verdict === "helpful") helpful += 1;
    else if (verdict === "noise") noise += 1;
  }
  const rated = helpful + noise;
  return {
    total: findings.length,
    helpful,
    noise,
    unrated: findings.length - rated,
    helpfulRate: rated > 0 ? helpful / rated : null,
  };
}

// Serializes one reviewed report into a benchmark record so future judgment layers
// (rule tweaks or LLM prompts) can be scored against the same human verdicts.
export function buildEvaluationDataset(
  report: MeetingReport,
  feedback: ReportFeedbackMap,
  exportedAt = Date.now(),
): EvaluationDataset {
  return {
    version: 1,
    meetingId: report.meetingId,
    meetingTitle: report.meetingTitle,
    reportGeneratedAt: report.generatedAt,
    exportedAt,
    summary: summarizeFeedback(report.findings, feedback),
    entries: report.findings.map((finding) => ({
      findingId: finding.id,
      kind: finding.kind,
      gapType: finding.gapType,
      topicTitle: finding.topicTitle,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence,
      verdict: feedback[finding.id] ?? null,
      llmVerdict: finding.llm?.verdict ?? null,
      llmReason: finding.llm?.reason ?? null,
    })),
  };
}
