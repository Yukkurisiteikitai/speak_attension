import { Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { mindmapPositions, radialPositions } from "../utils/ideaLayout";
import type { IdeaDecision, IdeaPhase, IdeaSessionState } from "../utils/ideaSession";

const GROUP_COLORS = ["#116147", "#b76a1f", "#4756a6", "#a64845", "#6c6218", "#2e7d84", "#8a4d8f", "#5a6b3b"];

type IdeaFlowNodeData = {
  label: string;
  kind: "center" | "group" | "keyword";
  mentionCount?: number;
  decision?: IdeaDecision;
  color?: string;
  phase: IdeaPhase;
};

export type IdeaFlowNode = Node<IdeaFlowNodeData>;

export function decisionLabel(decision: IdeaDecision): string {
  if (decision === "adopted") return "採用";
  if (decision === "rejected") return "却下";
  return "保留";
}

function IdeaNode({ data }: NodeProps<IdeaFlowNode>) {
  const pickable = data.kind === "keyword" && data.phase === "select";
  const isHierarchy = data.phase === "grouping" || data.phase === "select";
  const classNames = [
    "idea-node",
    `idea-node-${data.kind}`,
    data.decision ? `is-${data.decision}` : "",
    pickable ? "is-pickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={data.color ? { borderColor: data.color } : undefined}>
      <Handle type="target" position={isHierarchy ? Position.Left : Position.Top} className="idea-node-handle" />
      <strong>{data.label}</strong>
      {typeof data.mentionCount === "number" && data.mentionCount > 1 ? <span>×{data.mentionCount}</span> : null}
      {data.decision ? <span className="idea-decision-mark">{decisionLabel(data.decision)}</span> : null}
      <Handle type="source" position={isHierarchy ? Position.Right : Position.Top} className="idea-node-handle" />
    </div>
  );
}

export const ideaNodeTypes = { idea: IdeaNode };

export function buildIdeaFlowElements(
  session: Pick<IdeaSessionState, "groups" | "keywords" | "phase" | "title">,
): { nodes: IdeaFlowNode[]; edges: Edge[] } {
  const { groups, keywords, phase, title } = session;
  const edges: Edge[] = [];
  const centerNode: IdeaFlowNode = {
    id: "idea-center",
    type: "idea",
    position: { x: 0, y: 0 },
    data: { label: title, kind: "center", phase },
    draggable: false,
  };

  if (phase === "capture") {
    const layout = radialPositions(keywords, title);
    const nodes: IdeaFlowNode[] = [{ ...centerNode, position: layout.centerPosition }];

    for (const keyword of keywords) {
      nodes.push({
        id: keyword.id,
        type: "idea",
        position: layout.keywordPositions.get(keyword.id) ?? { x: 0, y: 0 },
        data: { label: keyword.label, kind: "keyword", mentionCount: keyword.mentionCount, phase },
      });
      edges.push({
        id: `edge-center-${keyword.id}`,
        source: "idea-center",
        target: keyword.id,
        type: "straight",
        style: { stroke: "rgba(62, 76, 65, 0.25)", strokeWidth: 1 },
      });
    }

    return { nodes, edges };
  }

  const layout = mindmapPositions(groups, keywords, title);
  const colorByGroup = new Map(groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]));
  const nodes: IdeaFlowNode[] = [{ ...centerNode, position: layout.centerPosition }];

  for (const group of groups) {
    const color = colorByGroup.get(group.id);
    nodes.push({
      id: group.id,
      type: "idea",
      position: layout.groupPositions.get(group.id) ?? { x: 0, y: 0 },
      data: { label: group.title, kind: "group", color, phase },
    });
    edges.push({
      id: `edge-center-${group.id}`,
      source: "idea-center",
      target: group.id,
      type: "straight",
      style: { stroke: color, strokeWidth: 2 },
    });
  }

  for (const keyword of keywords) {
    const color = keyword.groupId ? colorByGroup.get(keyword.groupId) : undefined;
    nodes.push({
      id: keyword.id,
      type: "idea",
      position: layout.keywordPositions.get(keyword.id) ?? { x: 0, y: 0 },
      data: {
        label: keyword.label,
        kind: "keyword",
        mentionCount: keyword.mentionCount,
        decision: keyword.decision,
        color,
        phase,
      },
    });
    if (keyword.groupId) {
      edges.push({
        id: `edge-${keyword.groupId}-${keyword.id}`,
        source: keyword.groupId,
        target: keyword.id,
        type: "straight",
        style: { stroke: color, strokeWidth: 1.4, opacity: 0.7 },
      });
    }
  }

  return { nodes, edges };
}
