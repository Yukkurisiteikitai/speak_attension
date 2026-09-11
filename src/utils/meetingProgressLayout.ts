import { Position, type Edge, type Node } from "@xyflow/react";
import type { MeetingProgress } from "./meetingProgress";

export function projectMeetingProgress(progress: MeetingProgress, showSequence: boolean): { nodes: Node[]; edges: Edge[] } {
  const children = new Map<string, typeof progress.nodes>();
  for (const node of progress.nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const positions = new Map<string, { x: number; y: number }>();
  let row = 0;
  const visiting = new Set<string>();
  function place(id: string, depth: number): number {
    if (visiting.has(id)) return row * 188;
    visiting.add(id);
    const branch = children.get(id) ?? [];
    const ys = branch.map((node) => place(node.id, depth + 1));
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++ * 188;
    positions.set(id, { x: depth * 390, y });
    return y;
  }
  place("progress-root", 0);
  return {
    nodes: progress.nodes.map((node) => ({ id: node.id, position: positions.get(node.id) ?? { x: 0, y: row++ * 188 },
      data: { label: `${node.sequence ? `${node.sequence}. ` : ""}${node.kind}\n${Array.from(node.label).slice(0, 50).join("")}${Array.from(node.label).length > 50 ? "…" : ""}` },
      sourcePosition: Position.Right, targetPosition: Position.Left, draggable: false,
      style: { width: 290, height: 150, padding: 14, fontSize: 14, lineHeight: "22px", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
        background: node.planned ? "#fff8e5" : node.kind === "決定" ? "#e1f3ea" : "#fff",
        border: node.planned ? "2px dashed #b67b29" : "1px solid #78a08d", borderRadius: 12 } })),
    edges: [
      ...progress.nodes.filter((node) => node.parentId).map((node) => ({ id: `parent-${node.id}`, source: node.parentId!, target: node.id,
        type: "smoothstep", label: node.planned ? "検討の予定" : undefined, style: node.planned ? { strokeDasharray: "5 4", stroke: "#b67b29" } : { stroke: "#598471" } })),
      ...progress.links.filter((link) => link.kind !== "sequence" || showSequence).map((link, index) => ({ id: `link-${index}`, source: link.source, target: link.target,
        label: link.label, style: { stroke: link.kind === "sequence" ? "#8295b8" : "#35786a", strokeDasharray: link.kind === "sequence" ? "2 5" : undefined } })),
    ],
  };
}
