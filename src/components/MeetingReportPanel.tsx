import { useMemo, useState } from "react";
import { Download, FileText, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { downloadFile } from "../lib/download";
import type { AnalyzedSegment, ConversationTreeState, ImportantMention, MeetingGraph } from "../types/topic";
import { type LlmSettings } from "../utils/llmClient";
import { checkLlmConnection } from "../utils/llmConnection";
import { reviewReportWithLlm } from "../utils/llmGapReview";
import { buildMeetingReport, renderMeetingReportMarkdown, type MeetingReport, type MeetingReportFinding } from "../utils/meetingReport";
import { buildEvaluationDataset, summarizeFeedback, type FindingVerdict, type ReportFeedbackMap } from "../utils/reportFeedback";

type MeetingReportPanelProps = {
  conversationTree: ConversationTreeState;
  meetingGraph: MeetingGraph;
  importantMentions: ImportantMention[];
  segmentArchive: AnalyzedSegment[];
  llmSettings: LlmSettings;
  onUpdateLlmSettings: (patch: Partial<LlmSettings>) => void;
};

function feedbackStorageKey(report: MeetingReport): string {
  return `speak_attension.feedback.${report.meetingId}.${report.generatedAt}`;
}

function loadFeedback(report: MeetingReport): ReportFeedbackMap {
  try {
    const raw = window.localStorage.getItem(feedbackStorageKey(report));
    return raw ? (JSON.parse(raw) as ReportFeedbackMap) : {};
  } catch {
    return {};
  }
}

function severityLabel(severity: MeetingReportFinding["severity"]): string {
  return severity === "high" ? "高" : severity === "medium" ? "中" : "低";
}

function FindingCard({
  finding,
  verdict,
  onVerdict,
}: {
  finding: MeetingReportFinding;
  verdict: FindingVerdict | undefined;
  onVerdict: (findingId: string, verdict: FindingVerdict) => void;
}) {
  return (
    <article className={`finding-card ${finding.llm?.verdict === "drop" ? "finding-dropped" : ""}`}>
      <div className="finding-head">
        <span className={`severity-badge severity-${finding.severity}`}>{severityLabel(finding.severity)}</span>
        <strong>{finding.topicTitle ?? "トピック未紐付"}</strong>
        <span className="finding-title">{finding.title}</span>
        {finding.kind === "llm_added" ? <span className="llm-badge">LLM追加</span> : null}
      </div>
      <p>{finding.detail}</p>
      {finding.llm ? (
        <p className="finding-llm-note">
          LLM判定: {finding.llm.verdict === "confirm" ? "妥当" : "除外候補"}
          {finding.llm.reason ? ` — ${finding.llm.reason}` : ""}
        </p>
      ) : null}
      {finding.evidence.length > 0 ? (
        <div className="finding-evidence">
          {finding.evidence.map((text, index) => (
            <p key={index}>「{text}」</p>
          ))}
        </div>
      ) : null}
      <div className="verdict-buttons">
        <button
          type="button"
          className={verdict === "helpful" ? "verdict-active" : ""}
          onClick={() => onVerdict(finding.id, "helpful")}
        >
          <ThumbsUp size={15} />
          <span>助かった</span>
        </button>
        <button
          type="button"
          className={verdict === "noise" ? "verdict-active verdict-noise" : ""}
          onClick={() => onVerdict(finding.id, "noise")}
        >
          <ThumbsDown size={15} />
          <span>ノイズ</span>
        </button>
      </div>
    </article>
  );
}

// Post-meeting deliverable: turn the engine state into a reviewable missing-items
// report, collect helpful/noise verdicts as evaluation data, and optionally get a
// second opinion from a local LLM (LM Studio's OpenAI-compatible server).
export function MeetingReportPanel({ conversationTree, meetingGraph, importantMentions, segmentArchive, llmSettings, onUpdateLlmSettings }: MeetingReportPanelProps) {
  const [report, setReport] = useState<MeetingReport | null>(null);
  const [feedback, setFeedback] = useState<ReportFeedbackMap>({});
  const [llmStatus, setLlmStatus] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);

  const summary = useMemo(() => (report ? summarizeFeedback(report.findings, feedback) : null), [feedback, report]);

  const generateReport = () => {
    const nextReport = buildMeetingReport({ meetingGraph, importantMentions, segments: segmentArchive });
    setReport(nextReport);
    setFeedback(loadFeedback(nextReport));
    setLlmStatus(null);
  };

  const handleVerdict = (findingId: string, verdict: FindingVerdict) => {
    if (!report) return;
    setFeedback((current) => {
      const next: ReportFeedbackMap = { ...current };
      if (next[findingId] === verdict) delete next[findingId];
      else next[findingId] = verdict;
      window.localStorage.setItem(feedbackStorageKey(report), JSON.stringify(next));
      return next;
    });
  };

  const handleCheckConnection = async () => {
    setLlmStatus("接続確認中...");
    const result = await checkLlmConnection(llmSettings);
    if (result.autofillModel) onUpdateLlmSettings({ model: result.autofillModel });
    setLlmStatus(result.statusMessage);
  };

  const runLlmReview = async () => {
    if (!report || isReviewing) return;
    setIsReviewing(true);
    setLlmStatus("LLMレビュー実行中...");
    try {
      const result = await reviewReportWithLlm(report, llmSettings);
      setReport({ ...report, findings: result.findings });
      setLlmStatus(
        result.errors.length > 0
          ? `レビュー完了 (${result.reviewedGroupCount}グループ成功 / 失敗: ${result.errors.join(" / ")})`
          : `レビュー完了 (${result.reviewedGroupCount}グループ)`,
      );
    } catch (error) {
      setLlmStatus(`レビュー失敗: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsReviewing(false);
    }
  };

  const downloadMarkdown = () => {
    if (!report) return;
    downloadFile(`meeting-report-${report.generatedAt}.md`, renderMeetingReportMarkdown(report), "text/markdown");
  };

  const downloadEvaluation = () => {
    if (!report) return;
    downloadFile(
      `meeting-evaluation-${report.generatedAt}.json`,
      JSON.stringify(buildEvaluationDataset(report, feedback, Date.now(), conversationTree.nodes), null, 2),
      "application/json",
    );
  };

  return (
    <section className="panel meeting-report-panel" aria-label="Meeting Report">
      <div className="section-head">
        <h2>抜け漏れレポート</h2>
        <span>{report ? `${report.findings.length}件の指摘` : "未生成"}</span>
      </div>

      <div className="report-actions">
        <button type="button" onClick={generateReport} disabled={segmentArchive.length === 0}>
          <FileText size={17} />
          <span>レポート生成</span>
        </button>
        <button type="button" onClick={downloadMarkdown} disabled={!report}>
          <Download size={17} />
          <span>Markdown</span>
        </button>
        <button type="button" onClick={downloadEvaluation} disabled={!report}>
          <Download size={17} />
          <span>評価データ</span>
        </button>
      </div>

      {summary ? (
        <div className="segment-buffer report-summary">
          <span>納得率 (助かった / 評価済み)</span>
          <p>
            {summary.helpfulRate === null ? "未評価" : `${Math.round(summary.helpfulRate * 100)}%`} — 助かった {summary.helpful} / ノイズ {summary.noise} / 未評価 {summary.unrated}
          </p>
        </div>
      ) : null}

      <div className="llm-settings">
        <label className="field-label" htmlFor="llmBaseUrl">
          LM Studio API URL
        </label>
        <input
          id="llmBaseUrl"
          type="text"
          value={llmSettings.baseUrl}
          onChange={(event) => onUpdateLlmSettings({ baseUrl: event.currentTarget.value })}
        />
        <label className="field-label" htmlFor="llmModel">
          Model
        </label>
        <input
          id="llmModel"
          type="text"
          placeholder="接続確認で自動選択"
          value={llmSettings.model}
          onChange={(event) => onUpdateLlmSettings({ model: event.currentTarget.value })}
        />
        <div className="report-actions">
          <button type="button" onClick={handleCheckConnection}>
            <span>接続確認</span>
          </button>
          <button type="button" onClick={runLlmReview} disabled={!report || isReviewing || !llmSettings.model}>
            <Sparkles size={17} />
            <span>LLMレビュー</span>
          </button>
        </div>
        {llmStatus ? <p className="llm-status">{llmStatus}</p> : null}
      </div>

      <div className="report-findings">
        {report && report.findings.length === 0 ? <p className="report-empty">指摘事項はありません。</p> : null}
        {report?.findings.map((finding) => (
          <FindingCard key={finding.id} finding={finding} verdict={feedback[finding.id]} onVerdict={handleVerdict} />
        ))}
      </div>
    </section>
  );
}
