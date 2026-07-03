import type { SessionLogEntry, TopicGraphNode, TranscriptSegment } from "../types/topic";

type TopicInspectorProps = {
  connectionStatus: string;
  currentTopic: TopicGraphNode | null;
  heatLeaders: TopicGraphNode[];
  logs: SessionLogEntry[];
  nodes: TopicGraphNode[];
  segments: TranscriptSegment[];
};

export function TopicInspector({
  connectionStatus,
  currentTopic,
  heatLeaders,
  logs,
  nodes,
  segments,
}: TopicInspectorProps) {
  const sessionJson = JSON.stringify(
    {
      connectionStatus,
      currentTopicId: currentTopic?.id ?? null,
      nodes: nodes.map((node) => ({
        id: node.id,
        ...node.data,
      })),
      segments,
      logs,
    },
    null,
    2,
  );

  return (
    <aside className="panel inspector-panel" aria-label="議題インスペクター">
      <section>
        <div className="section-head">
          <h2>現在の議題</h2>
        </div>
        <div className="current-topic-card">
          <span>{currentTopic ? currentTopic.id : "none"}</span>
          <strong>{currentTopic?.data.label ?? "まだ検知されていません"}</strong>
          <p>{currentTopic?.data.evidence[0] ?? "発話が5秒ごとに確定すると、ここに推定議題が表示されます。"}</p>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>heat 上位</h2>
        </div>
        <div className="heat-list">
          {heatLeaders.map((node) => (
            <div className="heat-row" key={node.id}>
              <span>{node.data.label}</span>
              <meter min={0} max={1} value={node.data.heat} />
              <strong>{node.data.heat.toFixed(2)}</strong>
            </div>
          ))}
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
