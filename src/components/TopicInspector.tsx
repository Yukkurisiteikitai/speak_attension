import { useMemo } from "react";
import type {
  AnalyzedSegment,
  FocusState,
  ImportantMention,
  MeetingGraph,
  SessionLogEntry,
  TopicDecisionLog,
  TopicGap,
} from "../types/topic";
import { buildReaderGuide } from "../utils/readerGuide";

type TopicInspectorProps = {
  connectionStatus: string;
  currentTopicGaps: TopicGap[];
  currentTopicId: string | null;
  decisionLogs: TopicDecisionLog[];
  focusState: FocusState;
  importantMentions: ImportantMention[];
  logs: SessionLogEntry[];
  meetingGraph: MeetingGraph;
  onFocusLockedChange: (locked: boolean) => void;
  onManualFocusChange: (topicId: string | null) => void;
  segments: AnalyzedSegment[];
};

function topicLabel(graph: MeetingGraph, topicId: string | null): string {
  if (!topicId) return "なし";
  return graph.nodes.find((node) => node.id === topicId)?.title ?? "不明";
}

function severityLabel(severity: TopicGap["severity"]): string {
  if (severity === "high") return "高";
  if (severity === "medium") return "中";
  return "低";
}

function focusSetByLabel(focusSetBy: FocusState["focusSetBy"]): string {
  return focusSetBy === "manual" ? "手動" : "自動";
}

function coverageChecklist(topicId: string | null, graph: MeetingGraph) {
  const topic = graph.nodes.find((node) => node.id === topicId);
  if (!topic) return [];
  return Object.entries(topic.coverage).map(([key, value]) => ({ key, value }));
}

// Diagnostic panel: shows the current topic state, the missing pieces, and the raw analysis trail.
export function TopicInspector({
  connectionStatus,
  currentTopicGaps,
  currentTopicId,
  decisionLogs,
  focusState,
  importantMentions,
  logs,
  meetingGraph,
  onFocusLockedChange,
  onManualFocusChange,
  segments,
}: TopicInspectorProps) {
  const currentTopic = meetingGraph.nodes.find((node) => node.id === currentTopicId) ?? null;
  const latestSegment = segments[0] ?? null;
  const latestDecision = decisionLogs[0] ?? null;
  const meetingGaps = meetingGraph.gapSummary.gaps.slice(0, 8);
  const focusOptions = meetingGraph.nodes.filter((node) => node.id !== meetingGraph.rootTopicId);
  const checklist = coverageChecklist(currentTopicId, meetingGraph);
  const readerGuide = buildReaderGuide({
    currentTopic,
    currentTopicGaps,
    focusState,
    latestSegment,
  });

  const sessionJson = useMemo(
    () =>
      JSON.stringify(
        {
          connectionStatus,
          focusState,
          currentTopic: currentTopic?.title ?? null,
          latestSegment,
          latestDecision,
          meetingGraph,
          importantMentions,
          logs: logs.slice(0, 20),
        },
        null,
        2,
      ),
    [connectionStatus, currentTopic?.title, focusState, importantMentions, latestDecision, latestSegment, logs, meetingGraph],
  );

  return (
    <aside className="panel inspector-panel" aria-label="meeting inspector">
      <section>
        <div className="section-head">
          <h2>現在の議題</h2>
          <span>{focusSetByLabel(focusState.focusSetBy)}{focusState.locked ? " / 固定" : ""}</span>
        </div>
        <div className="current-topic-card">
          <strong>{currentTopic?.title ?? "まだ議題がありません"}</strong>
          <p>{currentTopic ? "進行中" : "会話から最初の議題を抽出します。"}</p>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>初見ガイド</h2>
          <span>初回向け</span>
        </div>
        <article className="guide-card">
          <strong>この画面が今伝えていること</strong>
          <p>{readerGuide.summary}</p>
        </article>
        <div className="guide-list">
          {readerGuide.unknowns.map((item) => (
            <article className="guide-card" key={item}>
              <strong>まだ分からないこと</strong>
              <p>{item}</p>
            </article>
          ))}
        </div>
        <div className="guide-list">
          {readerGuide.hints.map((item) => (
            <article className="guide-card hint" key={item}>
              <strong>読み方</strong>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>カバレッジ</h2>
          <span>{checklist.filter((item) => item.value).length} / {checklist.length}</span>
        </div>
        <div className="checklist-grid">
          {checklist.length ? (
            checklist.map((item) => (
              <div className={`checklist-item ${item.value ? "is-complete" : ""}`} key={item.key}>
                <strong>{item.key}</strong>
                <span>{item.value ? "取得済み" : "未取得"}</span>
              </div>
            ))
          ) : (
            <p className="empty-text">議題が選ばれるとカバレッジが出ます。</p>
          )}
        </div>
      </section>


      <section>
        <div className="section-head">
          <h2>会議の抜け漏れ</h2>
          <span>{meetingGraph.gapSummary.gaps.length}</span>
        </div>
        {meetingGaps.length ? (
          <div className="gap-list">
            {meetingGaps.map((gap) => (
              <article className={`gap-card severity-${gap.severity}`} key={gap.id}>
                <strong>{topicLabel(meetingGraph, gap.topicId)} / {gap.title}</strong>
                <span>{severityLabel(gap.severity)}</span>
                <p>{gap.detail}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-text">まだ会議全体の抜けはありません。</p>
        )}
      </section>

      <details className="dev-drawer">
        <summary>開発者向け詳細</summary>

        <section className="dev-section">
          <div className="section-head">
            <h2>Focus Controls</h2>
            <span>{connectionStatus}</span>
          </div>
          <div className="focus-controls">
            <label className="field-label" htmlFor="focus-topic-select">
              手動Focus
            </label>
            <select
              id="focus-topic-select"
              value={focusState.focusTopicId ?? ""}
              onChange={(event) => onManualFocusChange(event.currentTarget.value || null)}
            >
              <option value="">Focusなし</option>
              {focusOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title}
                </option>
              ))}
            </select>
            <label className="focus-lock-control">
              <input
                checked={focusState.locked}
                type="checkbox"
                onChange={(event) => onFocusLockedChange(event.currentTarget.checked)}
              />
              <span>focusをロック</span>
            </label>
          </div>
        </section>

        <section className="dev-section">
          <div className="section-head">
            <h2>Latest Analysis</h2>
            <span>{latestSegment?.analysis.focusRelation ?? "none"}</span>
          </div>
          {latestSegment ? (
            <div className="analysis-card">
              <p>{latestSegment.text}</p>
              <dl>
                <div>
                  <dt>selected</dt>
                  <dd>{latestSegment.analysis.selectedTopicLabel ?? "none"}</dd>
                </div>
                <div>
                  <dt>intent</dt>
                  <dd>{latestSegment.analysis.intent}</dd>
                </div>
                <div>
                  <dt>phrases</dt>
                  <dd>{latestSegment.analysis.candidateTopicPhrases.map((item) => item.phrase).join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt>coverage</dt>
                  <dd>{latestSegment.analysis.coverageUpdates.map((item) => item.key).join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt>gaps</dt>
                  <dd>{latestSegment.analysis.createdGapIds.join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt>reason</dt>
                  <dd>{latestSegment.analysis.reason}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="empty-text">まだ発話分析はありません。</p>
          )}
        </section>

        <section className="dev-section">
          <div className="section-head">
            <h2>Score Breakdown</h2>
            <span>{latestDecision?.topicScores.length ?? 0}</span>
          </div>
          {latestDecision?.topicScores.length ? (
            <div className="score-breakdown-list">
              {latestDecision.topicScores.map((score) => (
                <article className="score-breakdown-card" key={score.topicId}>
                  <div className="score-breakdown-head">
                    <strong>{score.label}</strong>
                    <span>{score.score.toFixed(2)}</span>
                  </div>
                  <p>{score.reason}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-text">score breakdownはありません。</p>
          )}
        </section>

        <section className="dev-section">
          <div className="section-head">
            <h2>Important Mentions</h2>
            <span>{importantMentions.length}</span>
          </div>
          {importantMentions.length ? (
            <div className="gap-list">
              {importantMentions.slice(0, 6).map((mention) => (
                <article className="gap-card severity-medium" key={mention.id}>
                  <strong>{mention.type}</strong>
                  <span>{topicLabel(meetingGraph, mention.relatedTopicId)}</span>
                  <p>{mention.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-text">重要メモはまだありません。</p>
          )}
        </section>

        <section className="dev-section">
          <div className="section-head">
            <h2>Raw JSON</h2>
            <span>{logs.length} logs</span>
          </div>
          <pre className="json-panel">{sessionJson}</pre>
        </section>
      </details>
    </aside>
  );
}
