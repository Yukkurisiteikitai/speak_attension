import { Background, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphTopicNodeData, TopicGraphEdge, TopicGraphNode } from "../types/topic";

type TopicGraphProps = {
  currentTopicId: string | null;
  edges: TopicGraphEdge[];
  nodes: TopicGraphNode[];
};

function TopicNode({ data }: NodeProps<TopicGraphNode & { data: GraphTopicNodeData }>) {
  const heatPercent = Math.round(data.heat * 100);
  return (
    <div className={`topic-node ${data.isActive ? "is-active" : ""}`} style={{ "--heat": data.heat } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} />
      <div className="topic-node-head">
        <strong>{data.label}</strong>
        <span>{heatPercent}</span>
      </div>
      <div className="heat-track" aria-label={`heat ${heatPercent}`}>
        <div style={{ width: `${heatPercent}%` }} />
      </div>
      <small>{data.evidence[0] ?? data.keywords.slice(0, 3).join(" / ")}</small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = {
  topic: TopicNode,
};

export function TopicGraph({ currentTopicId, edges, nodes }: TopicGraphProps) {
  const graphNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      isActive: node.id === currentTopicId,
    },
  }));

  return (
    <section className="graph-panel" aria-label="議題グラフ">
      <div className="graph-title">
        <h2>議題グラフ</h2>
        <span>{currentTopicId ? "Live highlight" : "Waiting for speech"}</span>
      </div>
      <ReactFlow
        nodes={graphNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.35}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
