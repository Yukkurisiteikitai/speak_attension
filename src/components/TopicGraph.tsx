import { Background, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import { useMemo, useState } from "react";
import type { AnalyzedSegment, GraphTopicNodeData, MeetingGraph, TopicGraphNode } from "../types/topic";
import { projectGraphToFlow } from "../utils/topicProjection";
import { MapViewportControls } from "./MapViewportControls";

type TopicGraphProps = {
  currentTopicId: string | null;
  meetingGraph: MeetingGraph;
  segments: AnalyzedSegment[];
};

const lifecycleLabels = {
  active: "話題中",
  discussed: "話し合い済み",
  decided: "決定済み",
  unresolved: "未解決",
} as const;

const stateLabels = {
  active: "話題中",
  discussed: "話し合い済み",
  shallow: "要確認",
  missing: "不足あり",
  decided: "決定済み",
  unresolved: "未解決",
} as const;

function TopicNode({ data }: NodeProps<TopicGraphNode & { data: GraphTopicNodeData }>) {
  const isLeftBranch = data.branchSide === "left";
  if (data.kind === "utterance") {
    return (
      <div className="topic-node kind-utterance">
        <Handle type="target" id="parent" position={isLeftBranch ? Position.Right : Position.Left} />
        <div className="utterance-node-meta">
          <span>発言 {String(data.sequence ?? 1).padStart(2, "0")}</span>
          {data.sourceLabel ? <span>{data.sourceLabel}</span> : null}
        </div>
        <p>{data.label}</p>
      </div>
    );
  }

  const canToggle = data.kind === "topic" && Boolean(data.childCount);
  return (
    <div className={`topic-node kind-${data.kind} ${data.isActive ? "is-active" : ""}`}>
      {data.kind === "root" ? (
        <>
          <Handle type="source" id="parent-left" position={Position.Left} />
          <Handle type="source" id="parent-right" position={Position.Right} />
        </>
      ) : (
        <Handle type="target" id="parent" position={isLeftBranch ? Position.Right : Position.Left} />
      )}
      <div className="topic-node-head">
        <strong>{data.label}</strong>
        {typeof data.mentionCount === "number" ? <span>発言 {data.mentionCount}</span> : null}
      </div>
      {data.lifecycle ? <p className="topic-node-lifecycle">{lifecycleLabels[data.lifecycle]}</p> : null}
      {data.states.length ? (
        <div className="topic-badge-row">
          {data.states.map((state) => (
            <span className={`topic-badge state-${state}`} key={state}>
              {stateLabels[state]}
            </span>
          ))}
        </div>
      ) : null}
      {canToggle ? (
        <button
          type="button"
          className="topic-branch-toggle"
          aria-label={`${data.label}の会話を${data.isCollapsed ? "展開" : "折りたたむ"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (data.topicId) data.onToggle?.(data.topicId);
          }}
        >
          <span aria-hidden="true">{data.isCollapsed ? "+" : "−"}</span>
          会話 {data.childCount}件
        </button>
      ) : null}
      {data.kind !== "root" ? (
        <Handle type="source" id="utterances" position={isLeftBranch ? Position.Left : Position.Right} />
      ) : null}
    </div>
  );
}

const nodeTypes = {
  topic: TopicNode,
};

export function TopicGraph({ currentTopicId, meetingGraph, segments }: TopicGraphProps) {
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<string>>(() => new Set());
  const topicIds = useMemo(
    () => meetingGraph.nodes.filter((node) => node.id !== meetingGraph.rootTopicId).map((node) => node.id),
    [meetingGraph.nodes, meetingGraph.rootTopicId],
  );
  const toggleTopic = (topicId: string) => {
    setCollapsedTopicIds((current) => {
      const next = new Set(current);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };
  const allCollapsed = topicIds.length > 0 && topicIds.every((topicId) => collapsedTopicIds.has(topicId));

  const { nodes, edges } = useMemo(() => {
    const projection = projectGraphToFlow({
      graph: meetingGraph,
      currentTopicId,
      evidenceByTopicId: new Map(),
      segments,
      collapsedTopicIds,
    });
    return {
      edges: projection.edges,
      nodes: projection.nodes.map((node) =>
        node.data.kind === "topic"
          ? { ...node, data: { ...node.data, onToggle: toggleTopic } }
          : node,
      ),
    };
  }, [collapsedTopicIds, currentTopicId, meetingGraph, segments]);
  return (
    <section className="graph-panel meeting-mindmap" aria-label="会議のマインドマップ">
      <div className="graph-title">
        <div>
          <h2>会話のマインドマップ</h2>
          <span>議題ごとに、関連する発言を時系列でたどれます</span>
        </div>
        <button
          type="button"
          className="mindmap-collapse-all"
          disabled={topicIds.length === 0}
          onClick={() => setCollapsedTopicIds(allCollapsed ? new Set() : new Set(topicIds))}
        >
          {allCollapsed ? "すべて展開" : "すべて折りたたむ"}
        </button>
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
        onNodeClick={(_, node) => {
          if (node.data.kind === "topic" && node.data.childCount) toggleTopic(node.id);
        }}
      >
        <Background gap={24} color="#e2e7e3" />
        <MapViewportControls fitKey="meeting-live" />
      </ReactFlow>
    </section>
  );
}
