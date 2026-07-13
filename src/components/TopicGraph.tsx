import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphTopicNodeData, TopicGraphEdge, TopicGraphNode } from "../types/topic";

type TopicGraphProps = {
  currentTopicId: string | null;
  edges: TopicGraphEdge[];
  nodes: TopicGraphNode[];
};

function TopicNode({ data }: NodeProps<TopicGraphNode & { data: GraphTopicNodeData }>) {
  return (
    <div className={`topic-node kind-${data.kind} ${data.isActive ? "is-active" : ""}`}>
      {data.kind !== "root" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="topic-node-head">
        <strong>{data.label}</strong>
        {typeof data.mentionCount === "number" ? <span>{data.mentionCount} mentions</span> : null}
      </div>
      {data.lifecycle ? <p className="topic-node-lifecycle">{data.lifecycle}</p> : null}
      <div className="topic-badge-row">
        {data.states
          .filter((state) => !["shallow", "missing", "unresolved"].includes(state))
          .map((state) => (
            <span className={`topic-badge state-${state}`} key={state}>
              {state}
            </span>
          ))}
      </div>
      {data.evidence ? <small>{data.evidence}</small> : null}
      {data.detail ? <small>{data.detail}</small> : null}
      {data.kind !== "gap" ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

const nodeTypes = {
  topic: TopicNode,
};

export function TopicGraph({ currentTopicId, edges, nodes }: TopicGraphProps) {
  return (
    <section className="graph-panel" aria-label="meeting topic graph">
      <div className="graph-title">
        <h2>Meeting Topic Map</h2>
        <span>{currentTopicId ? "current topic highlighted" : "waiting for first topic"}</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.35}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#d5ddd8" />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
