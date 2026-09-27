import { ThumbsUp } from "lucide-react";
import { useMemo } from "react";
import type { AnalyzedSegment, ConversationNodeRole, ConversationTreeState } from "../types/topic";

type ConversationTimelineProps = {
  conversationTree: ConversationTreeState;
  segments: AnalyzedSegment[];
  selectedNodeId: string | null;
  onRate: (nodeId: string) => void;
  onSelect: (nodeId: string | null) => void;
  onStart?: () => void;
};

const roleLabels: Record<ConversationNodeRole, string> = {
  topic: "話題",
  issue: "課題",
  cause: "原因",
  action: "アクション",
  alternative: "別案",
  statement: "発言",
};

export function ConversationTimeline({
  conversationTree,
  segments,
  selectedNodeId,
  onRate,
  onSelect,
  onStart,
}: ConversationTimelineProps) {
  const segmentById = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);

  const sortedNodes = useMemo(
    () => [...conversationTree.nodes].sort((a, b) => a.createdAt - b.createdAt),
    [conversationTree.nodes]
  );

  return (
    <section className="conversation-timeline" aria-label="会議の発言タイムライン">
      <div className="graph-title">
        <div>
          <h2>会話のタイムライン</h2>
          <span>発言を時系列で確認できます</span>
        </div>
      </div>

      {conversationTree.nodes.length === 0 ? (
        <div className="conversation-empty-state">
          <span className="empty-state-mark" aria-hidden="true">
            ◌
          </span>
          <p className="eyebrow">会話のマップ</p>
          <h3>話し始めると、会議の流れがここに見えてきます</h3>
          <p>
            発言を「話題 → 課題 → 原因 → アクション」に整理し、決まったことや未解決の点をたどれます。
          </p>
          <div className="empty-state-flow">
            <span>話題</span>
            <i>→</i>
            <span>課題</span>
            <i>→</i>
            <span>アクション</span>
          </div>
          {onStart ? (
            <button className="primary-button" type="button" onClick={onStart}>
              会議を始める
            </button>
          ) : null}
        </div>
      ) : null}

      {conversationTree.nodes.length > 0 ? (
        <ol className="timeline-list">
          {sortedNodes.map((node) => {
            const segment = segmentById.get(node.segmentId);
            const speaker = segment?.metadata?.speaker ?? "発言者不明";
            const isSelected = node.id === selectedNodeId;

            return (
              <li
                key={node.id}
                className={`timeline-row role-${node.role} ${isSelected ? "is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="timeline-row-button"
                  onClick={() => onSelect(isSelected ? null : node.id)}
                >
                  <time>
                    {new Date(node.createdAt).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>

                  <span className="timeline-speaker">{speaker}</span>

                  <span className={`timeline-role-chip role-${node.role}`}>
                    {roleLabels[node.role]}
                  </span>

                  <div className="timeline-text-content">
                    <div className="timeline-label">{node.label}</div>
                    {node.originalText !== node.label ? (
                      <details className="timeline-details">
                        <summary>原文を見る</summary>
                        <p>{node.originalText}</p>
                      </details>
                    ) : null}
                  </div>

                  {node.rating === 1 || node.manuallyAdjusted ? (
                    <span className="timeline-status">
                      {node.rating === 1 ? (
                        <span className="timeline-rating" aria-label="高評価">
                          <ThumbsUp size={14} aria-hidden="true" />
                        </span>
                      ) : null}
                      {node.manuallyAdjusted ? <span className="timeline-manually-adjusted">手動修正</span> : null}
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  className={`conversation-rating ${node.rating === 1 ? "is-rated" : ""}`}
                  aria-label={`${node.label}を高評価${node.rating === 1 ? "から戻す" : "する"}`}
                  aria-pressed={node.rating === 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRate(node.id);
                  }}
                >
                  <ThumbsUp size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
