import type { TopicGraphNode, TranscriptSegment } from "../types/topic";

type TranscriptPanelProps = {
  bufferText: string;
  interimText: string;
  lastFinalText: string;
  nodes: TopicGraphNode[];
  segments: TranscriptSegment[];
};

function topicLabel(nodes: TopicGraphNode[], topicId: string): string {
  return nodes.find((node) => node.id === topicId)?.data.label ?? "unknown";
}

export function TranscriptPanel({ bufferText, interimText, lastFinalText, nodes, segments }: TranscriptPanelProps) {
  return (
    <section className="panel transcript-panel" aria-label="リアルタイム文字起こし">
      <div className="section-head">
        <h2>リアルタイム文字起こし</h2>
      </div>

      <div className="live-transcript">
        <span>認識中</span>
        <p>{interimText || lastFinalText || "マイクを開始するとここに直近の発話が表示されます。"}</p>
      </div>

      <div className="segment-buffer">
        <span>5秒バッファ</span>
        <p>{bufferText || "発話待ち"}</p>
      </div>

      <div className="segment-list" aria-label="直近の発話セグメント">
        <h3>直近の発話セグメント</h3>
        {segments.length === 0 ? (
          <p className="empty-text">まだセグメントはありません。</p>
        ) : (
          segments.map((segment) => (
            <article className="segment-card" key={segment.id}>
              <time>{new Date(segment.createdAt).toLocaleTimeString("ja-JP")}</time>
              <span className="source-badge">{segment.source}</span>
              <p>{segment.text}</p>
              <span>{segment.matchedTopicIds.length ? segment.matchedTopicIds.map((topicId) => topicLabel(nodes, topicId)).join(", ") : "no match"}</span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
