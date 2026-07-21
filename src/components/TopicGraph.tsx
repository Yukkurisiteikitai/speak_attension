import { Background, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import { ThumbsUp } from "lucide-react";
import { useMemo } from "react";
import type { ConversationGraphNode, ConversationGraphNodeData, ConversationTreeState } from "../types/topic";
import { projectConversationTreeToFlow } from "../utils/conversationTreeLayout";
import { MapViewportControls } from "./MapViewportControls";

type TopicGraphProps = {
  conversationTree: ConversationTreeState;
  selectedNodeId: string | null;
  onRate: (nodeId: string) => void;
  onSelect: (nodeId: string | null) => void;
};

const roleLabels: Record<Exclude<ConversationGraphNodeData["role"], "root">, string> = {
  topic: "話題",
  issue: "課題",
  cause: "原因",
  action: "アクション",
  alternative: "別案",
  statement: "発言",
};

function roleLabel(role: ConversationGraphNodeData["role"]): string {
  return role === "root" ? "" : roleLabels[role];
}

function ConversationNode({ id, data }: NodeProps<ConversationGraphNode>) {
  const isRoot = data.role === "root";
  return (
    <div className={`conversation-node role-${data.role} ${data.selected ? "is-selected" : ""}`}>
      {!isRoot ? <Handle type="target" id="parent" position={Position.Left} /> : null}
      <div className="conversation-node-head">
        <strong>{data.label}</strong>
        {!isRoot ? <span>{roleLabel(data.role)}</span> : null}
      </div>
      {!isRoot ? (
        <button
          type="button"
          className={`conversation-rating ${data.rating === 1 ? "is-rated" : ""}`}
          aria-label={`${data.label}を高評価${data.rating === 1 ? "から戻す" : "する"}`}
          aria-pressed={data.rating === 1}
          onClick={(event) => {
            event.stopPropagation();
            data.onRate?.(id);
          }}
        >
          <ThumbsUp size={14} aria-hidden="true" />
          <span>{data.rating}</span>
        </button>
      ) : null}
      <Handle type="source" id="child" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { conversation: ConversationNode };

export function TopicGraph({ conversationTree, selectedNodeId, onRate, onSelect }: TopicGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const projection = projectConversationTreeToFlow(conversationTree, "会議");
    return {
      edges: projection.edges,
      nodes: projection.nodes.map((node) => ({
        ...node,
        data: { ...node.data, selected: node.id === selectedNodeId, onRate },
      })),
    };
  }, [conversationTree, onRate, selectedNodeId]);

  return (
    <section className="graph-panel meeting-mindmap conversation-tree-map" aria-label="会議の意味階層マインドマップ">
      <div className="graph-title">
        <div>
          <h2>会話のマインドマップ</h2>
          <span>話題から課題・原因・アクションをたどれます</span>
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => onSelect(null)}
        onNodeClick={(_, node) => onSelect(node.id === "conversation-root" ? null : node.id)}
      >
        <Background gap={24} color="#e2e7e3" />
        <MapViewportControls fitKey="conversation-live" />
      </ReactFlow>
    </section>
  );
}
