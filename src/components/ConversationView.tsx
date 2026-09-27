import { useState } from "react";
import type { AnalyzedSegment, ConversationTreeState } from "../types/topic";
import { ConversationTimeline } from "./ConversationTimeline";
import { TopicGraph } from "./TopicGraph";

type ConversationViewProps = {
  conversationTree: ConversationTreeState;
  segments: AnalyzedSegment[];
  selectedNodeId: string | null;
  onRate: (nodeId: string) => void;
  onSelect: (nodeId: string | null) => void;
  onStart?: () => void;
};

// Timeline is the primary way to read conversation history (ADR 0019 follow-up
// feedback). The existing relationship graph (TopicGraph) is not deleted — it
// stays reachable as a secondary view via one explicit toggle, never removed.
export function ConversationView({ conversationTree, segments, selectedNodeId, onRate, onSelect, onStart }: ConversationViewProps) {
  const [view, setView] = useState<"timeline" | "graph">("timeline");

  return (
    <div className="conversation-view">
      <div className="conversation-view-toggle" role="tablist" aria-label="会話の表示形式">
        <button type="button" role="tab" aria-selected={view === "timeline"} onClick={() => setView("timeline")}>
          タイムライン
        </button>
        <button type="button" role="tab" aria-selected={view === "graph"} onClick={() => setView("graph")}>
          関係を見る（グラフ）
        </button>
      </div>
      {/* Both stay mounted (hidden, not unmounted) so switching views never
          drops state -- in particular ConversationTimeline's manual
          classification corrections, which would otherwise silently reset
          on every toggle. Same pattern as the Idea/Meeting mode switch in
          App.tsx. */}
      <div hidden={view !== "timeline"}>
        <ConversationTimeline
          conversationTree={conversationTree}
          segments={segments}
          selectedNodeId={selectedNodeId}
          onRate={onRate}
          onSelect={onSelect}
          onStart={onStart}
        />
      </div>
      <div hidden={view !== "graph"}>
        <TopicGraph
          conversationTree={conversationTree}
          selectedNodeId={selectedNodeId}
          onRate={onRate}
          onSelect={onSelect}
          onStart={onStart}
        />
      </div>
    </div>
  );
}
