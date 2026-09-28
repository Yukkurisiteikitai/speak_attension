import { useState } from "react";
import type { ConversationTreeState } from "../types/topic";
import type { SemanticAxes } from "../semantic/types";
import type { TimelineRow } from "../semantic/timelineProjection";
import { ConversationTimeline } from "./ConversationTimeline";
import { TopicGraph } from "./TopicGraph";

type ConversationViewProps = {
  conversationTree: ConversationTreeState;
  timelineRows: TimelineRow[];
  selectedNodeId: string | null;
  onRate: (nodeId: string) => void;
  onSelect: (nodeId: string | null) => void;
  onCorrect: (target: { utteranceId: string; unitId?: string }, axes: Partial<SemanticAxes>) => void;
  onStart?: () => void;
};

// Timeline is the primary way to read conversation history (ADR 0019 follow-up
// feedback). The existing relationship graph (TopicGraph) is not deleted — it
// stays reachable as a secondary view via one explicit toggle, never removed.
export function ConversationView({ conversationTree, timelineRows, selectedNodeId, onRate, onSelect, onCorrect, onStart }: ConversationViewProps) {
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
          drops per-view UI state such as scroll position. Timeline corrections
          no longer depend on this: they are events in the semantic log, so they
          survive unmount on their own (ADR 0022 §5). */}
      <div hidden={view !== "timeline"}>
        <ConversationTimeline
          rows={timelineRows}
          conversationTree={conversationTree}
          selectedNodeId={selectedNodeId}
          onRate={onRate}
          onSelect={onSelect}
          onCorrect={onCorrect}
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
