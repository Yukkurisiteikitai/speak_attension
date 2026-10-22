import { Position, type Edge, type Node } from "@xyflow/react";
import type { MeetingDecisionGraph } from "../types/topic";
import { selectDecisionParents } from "./meetingDecisionGraph";
import { meetingStateLabels, meetingTypeLabels } from "./meetingState";

// One step at a time bounds the map even for a long meeting. Full source text
// remains in the adjacent inspector; nodes deliberately show a short preview.
export function projectMeetingDecisionStep(graph: MeetingDecisionGraph, selectedId: string): { nodes: Node[]; edges: Edge[] } {
  const selected = graph.nodes.find((node) => node.id === selectedId);
  if (!selected) return { nodes: [], edges: [] };
  const parents = selectDecisionParents(graph, selectedId).filter((node) => node.id !== selectedId);
  const displayed = [selected, ...parents];
  return {
    nodes: displayed.map((node, index) => ({
      id: node.id,
      position: { x: index === 0 ? 0 : 380, y: index === 0 ? Math.max(0, (parents.length - 1) * 90) : (index - 1) * 180 },
      data: { label: `${meetingTypeLabels[node.type]} / ${meetingStateLabels[node.state]}\n${Array.from(node.label).slice(0, 48).join("")}${Array.from(node.label).length > 48 ? "…" : ""}` },
      style: { width: 280, height: 140, padding: 16, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14, lineHeight: "22px", border: index === 0 ? "2px solid #24765d" : "1px solid #91a89e" },
      sourcePosition: Position.Right, targetPosition: Position.Left,
    })),
    edges: parents.map((node) => ({ id: `${selectedId}-${node.id}`, source: selectedId, target: node.id, label: node.type === "utterance" ? "元の発言" : "関連をたどる" })),
  };
}
