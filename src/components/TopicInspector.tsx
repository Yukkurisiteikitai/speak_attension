import type {
  AnalyzedSegment,
  FocusState,
  ImportantMention,
  SessionLogEntry,
  TopicDecisionLog,
  TopicGraphNode,
} from "../types/topic";

type TopicInspectorProps = {
  connectionStatus: string;
  decisionLogs: TopicDecisionLog[];
  focusState: FocusState;
  importantMentions: ImportantMention[];
  logs: SessionLogEntry[];
  nodes: TopicGraphNode[];
  segments: AnalyzedSegment[];
};

function topicLabel(nodes: TopicGraphNode[], topicId: string | null): string {
  if (!topicId) return "none";
  return nodes.find((node) => node.id === topicId)?.data.label ?? "unknown";
}

export function TopicInspector({
  connectionStatus,
  decisionLogs,
  focusState,
  importantMentions,
  logs,
  nodes,
  segments,
}: TopicInspectorProps) {
  const latestSegment = segments[0] ?? null;
  const latestDecision = decisionLogs[0] ?? null;
  const relatedSegments = segments
    .filter((segment) => ["on_focus", "adjacent"].includes(segment.analysis.focusRelation))
    .slice(0, 5);
  const unresolvedReferences = segments.flatMap((segment) =>
    segment.analysis.unresolvedReferences.map((phrase) => ({
      phrase,
      segmentId: segment.id,
      text: segment.text,
    })),
  );
  const displaySegments = segments.map((segment) => ({
    text: segment.text,
    source: segment.source,
    createdAt: segment.createdAt,
    matchedTopicLabels: segment.analysis.matchedTopicIds.map((topicId) => topicLabel(nodes, topicId)),
    analysis: {
      selectedTopicLabel: segment.analysis.selectedTopicLabel,
      matchedKeywords: segment.analysis.matchedKeywords,
      focusRelation: segment.analysis.focusRelation,
      focusAlignmentScore: segment.analysis.focusAlignmentScore,
      importanceType: segment.analysis.importanceType,
      resolvedReferences: segment.analysis.resolvedReferences.map((reference) => ({
        phrase: reference.phrase,
        candidateTopicLabel: topicLabel(nodes, reference.candidateTopicId),
        confidence: reference.confidence,
        reason: reference.reason,
      })),
      unresolvedReferences: segment.analysis.unresolvedReferences,
      shouldUpdateGraph: segment.analysis.shouldUpdateGraph,
      shouldUpdateCurrentTopic: segment.analysis.shouldUpdateCurrentTopic,
      shouldCreateNode: segment.analysis.shouldCreateNode,
      reason: segment.analysis.reason,
    },
  }));
  const sessionJson = JSON.stringify(
    {
      connectionStatus,
      focus: {
        label: focusState.focusLabel,
        setBy: focusState.focusSetBy,
        startedAt: focusState.startedAt,
        goal: focusState.goal ?? null,
      },
      latestAnalyzedSegment: displaySegments[0] ?? null,
      importantMentions: importantMentions.map((mention) => ({
        text: mention.text,
        type: mention.type,
        relatedTopicLabel: topicLabel(nodes, mention.relatedTopicId),
        confidence: mention.confidence,
      })),
      unresolvedReferences,
      decisionLogs: decisionLogs.map((log) => ({
        text: log.text,
        source: log.source,
        matchedKeywords: log.matchedKeywords,
        topicScores: log.topicScores.map((score) => ({
          label: score.label,
          score: score.score,
          reason: score.reason,
        })),
        selectedTopicLabel: topicLabel(nodes, log.selectedTopicId),
        unresolvedReferences: log.unresolvedReferences,
        createdAt: log.createdAt,
      })),
      analyzedSegments: displaySegments,
      logs: logs.map((log) => ({
        type: log.type,
        at: log.at,
        message: log.message,
      })),
    },
    null,
    2,
  );

  return (
    <aside className="panel inspector-panel" aria-label="議題インスペクター">
      <section>
        <div className="section-head">
          <h2>集中議題</h2>
          <span>{focusState.focusSetBy}</span>
        </div>
        <div className="current-topic-card">
          <span>{focusState.focusTopicId ? "focus" : "none"}</span>
          <strong>{focusState.focusLabel ?? "まだ設定されていません"}</strong>
          <p>{focusState.goal ?? "最初に検知された中心議題を自動でfocusにします。"}</p>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>現在の発話分析</h2>
          <span>{latestSegment?.source ?? "none"}</span>
        </div>
        {latestSegment ? (
          <div className={`analysis-card relation-${latestSegment.analysis.focusRelation}`}>
            <div className="analysis-relation-row">
              <strong>{latestSegment.analysis.focusRelation}</strong>
              <span>{latestSegment.analysis.focusAlignmentScore.toFixed(2)}</span>
            </div>
            <p>{latestSegment.text}</p>
            <dl>
              <div>
                <dt>selected</dt>
                <dd>{latestSegment.analysis.selectedTopicLabel ?? "none"}</dd>
              </div>
              <div>
                <dt>keywords</dt>
                <dd>{latestSegment.analysis.matchedKeywords.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt>graph</dt>
                <dd>
                  {latestSegment.analysis.shouldUpdateGraph ? "update" : "skip"} /{" "}
                  {latestSegment.analysis.shouldUpdateCurrentTopic ? "current topic update" : "current topic keep"}
                </dd>
              </div>
              <div>
                <dt>reason</dt>
                <dd>{latestSegment.analysis.reason}</dd>
              </div>
            </dl>
            {latestSegment.analysis.resolvedReferences.length ? (
              <div className="reference-list inline-reference-list">
                {latestSegment.analysis.resolvedReferences.map((reference, index) => (
                  <article className="reference-card" key={`${reference.phrase}-${index}`}>
                    <strong>{reference.phrase}</strong>
                    <span>
                      {topicLabel(nodes, reference.candidateTopicId)} / {reference.confidence.toFixed(2)}
                    </span>
                    <p>{reference.reason}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="empty-text">まだ発話分析はありません。</p>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Decision Log</h2>
          <span>{latestDecision?.source ?? "none"}</span>
        </div>
        {latestDecision ? (
          <div className="decision-card">
            <p>{latestDecision.text}</p>
            <dl>
              <div>
                <dt>selected</dt>
                <dd>{topicLabel(nodes, latestDecision.selectedTopicId)}</dd>
              </div>
              <div>
                <dt>keywords</dt>
                <dd>{latestDecision.matchedKeywords.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt>scores</dt>
                <dd>
                  {latestDecision.topicScores.length
                    ? latestDecision.topicScores.map((score) => `${score.label}:${score.score}`).join(" / ")
                    : "none"}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="empty-text">まだDecision Logはありません。</p>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>関連発話</h2>
        </div>
        <div className="reference-list">
          {relatedSegments.length ? (
            relatedSegments.map((segment) => (
              <article className="reference-card" key={segment.id}>
                <strong>{segment.analysis.selectedTopicLabel ?? "none"}</strong>
                <span>{segment.analysis.focusRelation}</span>
                <p>{segment.text}</p>
              </article>
            ))
          ) : (
            <p className="empty-text">関連発話はまだありません。</p>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>重要メモ</h2>
        </div>
        <div className="reference-list">
          {importantMentions.length ? (
            importantMentions.map((mention) => (
              <article className="reference-card important" key={mention.id}>
                <strong>{mention.type}</strong>
                <span>{topicLabel(nodes, mention.relatedTopicId)}</span>
                <p>{mention.text}</p>
              </article>
            ))
          ) : (
            <p className="empty-text">focus外の重要発話はまだありません。</p>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>未解決参照</h2>
        </div>
        <div className="reference-list">
          {unresolvedReferences.length ? (
            unresolvedReferences.slice(0, 5).map((reference) => (
              <article className="reference-card unresolved" key={`${reference.segmentId}-${reference.phrase}`}>
                <strong>{reference.phrase}</strong>
                <p>{reference.text}</p>
              </article>
            ))
          ) : (
            <p className="empty-text">未解決参照はありません。</p>
          )}
        </div>
      </section>

      <section className="log-section">
        <div className="section-head">
          <h2>セッションログJSON</h2>
          <span>{connectionStatus}</span>
        </div>
        <pre>{sessionJson}</pre>
      </section>
    </aside>
  );
}
