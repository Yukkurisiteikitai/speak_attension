import type { MeetingGraph, TranscriptSegment } from "../types/topic";

type TranscriptPanelProps = {
  bufferText: string;
  interimText: string;
  lastFinalText: string;
  meetingGraph: MeetingGraph;
  segments: TranscriptSegment[];
};

function topicLabel(graph: MeetingGraph, topicId: string): string {
  return graph.nodes.find((node) => node.id === topicId)?.title ?? "unknown";
}

export function TranscriptPanel({ bufferText, interimText, lastFinalText, meetingGraph, segments }: TranscriptPanelProps) {
  return (
    <section className="panel transcript-panel" aria-label="recent transcript">
      <div className="section-head">
        <h2>Recent Transcript</h2>
        <span>{segments.length} segments</span>
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
        <h3>Recent Segments</h3>
        {segments.length === 0 ? (
          <p className="empty-text">まだセグメントはありません。</p>
        ) : (
          segments.slice(0, 8).map((segment) => (
            <article className="segment-card" key={segment.id}>
              <div className="segment-meta-row">
                <time>{new Date(segment.createdAt).toLocaleTimeString("ja-JP")}</time>
                <span className="source-badge">{segment.source}</span>
                {segment.metadata?.speaker ? <span className="speaker-badge">{segment.metadata.speaker}</span> : null}
              </div>
              <p>{segment.text}</p>
              <span>
                {segment.matchedTopicIds.length
                  ? segment.matchedTopicIds.map((topicId) => topicLabel(meetingGraph, topicId)).join(", ")
                  : "no stable topic"}
              </span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
