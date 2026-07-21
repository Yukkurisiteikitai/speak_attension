import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import type { AnalyzedSegment, MeetingSummary, MeetingSummaryCategory, MeetingSummaryStatus } from "../types/topic";
import { MEETING_SUMMARY_CATEGORY_LABELS, MEETING_SUMMARY_CATEGORY_ORDER } from "../utils/meetingSynthesis";
import { MapViewportControls } from "./MapViewportControls";

type SummaryNodeKind = "root" | "topic" | "category" | "item" | "evidence";
type SummaryNodeData = {
  label: string;
  kind: SummaryNodeKind;
  nodeId?: string;
  childCount?: number;
  isCollapsed?: boolean;
  onToggle?: (nodeId: string) => void;
  onRename?: (nodeId: string, title: string) => void;
  selectableForIdeas?: boolean;
  selectedForIdeas?: boolean;
  onIdeaSelectionChange?: (nodeId: string) => void;
};

type SummaryNode = Node<SummaryNodeData, "summary">;
// Item nodes may contain a three-line Japanese title, selection checkbox and
// evidence toggle. Reserve their full rendered footprint so adjacent branches
// stay clear even for representative long labels.
const NODE_HEIGHT: Record<SummaryNodeKind, number> = { root: 82, topic: 72, category: 54, item: 138, evidence: 76 };
const NODE_WIDTH: Record<SummaryNodeKind, number> = { root: 240, topic: 230, category: 180, item: 270, evidence: 330 };

function SummaryNodeView({ data }: NodeProps<SummaryNode>) {
  const [editing, setEditing] = useState(false);
  const canRename = data.kind === "topic" || data.kind === "item";
  const canToggle = data.kind !== "root" && Boolean(data.childCount);
  const commit = (title: string) => {
    setEditing(false);
    if (data.nodeId) data.onRename?.(data.nodeId, title);
  };
  return (
    <div className={`summary-node summary-${data.kind}${data.selectedForIdeas ? " is-idea-selected" : ""}`}>
      {data.kind !== "root" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="summary-node-head">
        {editing ? (
          <input
            aria-label="タイトルを編集"
            autoFocus
            defaultValue={data.label}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value);
              if (event.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <strong>{data.label}</strong>
        )}
        {canRename && !editing ? <button type="button" onClick={() => setEditing(true)}>編集</button> : null}
      </div>
      {data.selectableForIdeas && data.nodeId ? (
        <label className="summary-idea-select" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={Boolean(data.selectedForIdeas)}
            onChange={() => data.onIdeaSelectionChange?.(data.nodeId!)}
          />
          アイデア出しへ送る
        </label>
      ) : null}
      {canToggle ? (
        <button
          type="button"
          className="summary-toggle"
          onClick={() => data.nodeId && data.onToggle?.(data.nodeId)}
        >
          {data.isCollapsed ? "＋" : "−"} {data.kind === "item" ? "原文" : "枝"} {data.childCount}件
        </button>
      ) : null}
      {data.kind !== "evidence" ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

const nodeTypes = { summary: SummaryNodeView };

type Tree = {
  id: string;
  label: string;
  kind: SummaryNodeKind;
  children: Tree[];
  childCount?: number;
  editable?: boolean;
  selectableForIdeas?: boolean;
};

function buildTree(summary: MeetingSummary, collapsedIds: Set<string>, segmentById: Map<string, AnalyzedSegment>): Tree {
  return {
    id: "summary-root",
    label: summary.title,
    kind: "root",
    children: summary.topics.map((topic) => {
      const categories = MEETING_SUMMARY_CATEGORY_ORDER.flatMap((category) => {
        const items = topic.items.filter((item) => item.category === category);
        if (!items.length) return [];
        const categoryId = `${topic.id}-${category}`;
        const itemTrees = items.map((item) => {
          const evidence = item.evidenceSegmentIds
            .map((segmentId) => segmentById.get(segmentId))
            .filter((segment): segment is AnalyzedSegment => Boolean(segment))
            .sort((left, right) => left.createdAt - right.createdAt)
            .map((segment) => ({ id: `${item.id}-${segment.id}`, label: segment.text, kind: "evidence" as const, children: [] }));
          return {
            id: item.id,
            label: item.title,
            kind: "item" as const,
            editable: true,
            selectableForIdeas: item.category === "issue" || item.category === "unresolved",
            childCount: evidence.length,
            children: collapsedIds.has(item.id) ? [] : evidence,
          };
        });
        return [{
          id: categoryId,
          label: MEETING_SUMMARY_CATEGORY_LABELS[category],
          kind: "category" as const,
          childCount: itemTrees.length,
          children: collapsedIds.has(categoryId) ? [] : itemTrees,
        }];
      });
      return {
        id: topic.id,
        label: topic.title,
        kind: "topic" as const,
        editable: true,
        childCount: categories.length,
        children: collapsedIds.has(topic.id) ? [] : categories,
      };
    }),
  };
}

function projectTree(
  tree: Tree,
  collapsedIds: Set<string>,
  selectedIdeaItemIds: Set<string>,
  onToggle: (id: string) => void,
  onRename: (id: string, title: string) => void,
  onIdeaSelectionChange: (id: string) => void,
) {
  const nodes: SummaryNode[] = [];
  const edges: Edge[] = [];
  const gap = 22;
  const measure = (node: Tree): number => node.children.length ? Math.max(NODE_HEIGHT[node.kind], node.children.reduce((sum, child, index) => sum + measure(child) + (index ? gap : 0), 0)) : NODE_HEIGHT[node.kind];
  let cursor = 60;
  const place = (node: Tree, depth: number, top: number): number => {
    const height = measure(node);
    nodes.push({
      id: node.id,
      type: "summary",
      position: { x: 40 + depth * 310, y: top + (height - NODE_HEIGHT[node.kind]) / 2 },
      data: {
        label: node.label,
        kind: node.kind,
        nodeId: node.id,
        childCount: node.childCount ?? (node.children.length || undefined),
        isCollapsed: collapsedIds.has(node.id),
        onToggle,
        onRename,
        selectableForIdeas: node.selectableForIdeas,
        selectedForIdeas: selectedIdeaItemIds.has(node.id),
        onIdeaSelectionChange,
      },
      draggable: false,
    });
    let childTop = top + (height - node.children.reduce((sum, child, index) => sum + measure(child) + (index ? gap : 0), 0)) / 2;
    node.children.forEach((child) => {
      const childHeight = place(child, depth + 1, childTop);
      edges.push({ id: `${node.id}-${child.id}`, source: node.id, target: child.id, type: "smoothstep" });
      childTop += childHeight + gap;
    });
    return height;
  };
  place(tree, 0, cursor);
  return { nodes, edges };
}

type MeetingSummaryGraphProps = {
  summary: MeetingSummary;
  status: MeetingSummaryStatus;
  error: string | null;
  stale: boolean;
  startedAt: number | null;
  segments: AnalyzedSegment[];
  onBack: () => void;
  onRefresh: () => void;
  onRename: (nodeId: string, title: string) => void;
  onStartIdeaSession: (selectedItemIds: string[]) => void;
};

function estimateOrganizationSeconds(segmentCount: number): number {
  return Math.min(30, Math.max(6, 4 + Math.ceil(segmentCount / 5) * 3));
}

function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function OrganizationProgress({ startedAt, status, segmentCount }: { startedAt: number | null; status: MeetingSummaryStatus; segmentCount: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "refining") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [status]);
  if (status !== "refining" || !startedAt) return null;

  const estimate = estimateOrganizationSeconds(segmentCount);
  const elapsed = Math.max(0, (now - startedAt) / 1_000);
  const progress = Math.min(90, 25 + (elapsed / estimate) * 65);
  return (
    <div className="organization-progress" aria-live="polite">
      <div><span>AI統合中</span><strong>{formatSeconds(elapsed)} / 約{formatSeconds(estimate)}</strong></div>
      <p>（整理済み {segmentCount} / {segmentCount} 発言）</p>
      <div className="organization-progress-track" role="progressbar" aria-label="会議整理の進捗" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>全発言の規則整理は完了しています。残りはローカルAIによる議題統合で、予想時間はモデルの処理速度で前後します。</small>
    </div>
  );
}

export function MeetingSummaryGraph({ summary, status, error, stale, startedAt, segments, onBack, onRefresh, onRename, onStartIdeaSession }: MeetingSummaryGraphProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedIdeaItemIds, setSelectedIdeaItemIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setCollapsedIds(new Set(summary.topics.flatMap((topic) => topic.items.map((item) => item.id))));
    setSelectedIdeaItemIds(new Set());
  }, [summary.generatedAt]);
  const segmentById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);
  const toggle = (nodeId: string) => setCollapsedIds((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
  });
  const toggleIdeaItem = (nodeId: string) => setSelectedIdeaItemIds((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
  });
  const { nodes, edges } = useMemo(
    () => projectTree(
      buildTree(summary, collapsedIds, segmentById),
      collapsedIds,
      selectedIdeaItemIds,
      toggle,
      onRename,
      toggleIdeaItem,
    ),
    [collapsedIds, onRename, segmentById, selectedIdeaItemIds, summary],
  );
  const sourceLabel = status === "refining" ? "規則で整理済み・LM Studioで整え中…" : status === "llm" ? "LM Studioで整理" : status === "error" ? "規則で整理（LM Studioは利用できませんでした）" : "規則で整理";
  return (
    <section className="graph-panel meeting-summary-map" aria-label="会議終了時の整理マップ">
      <div className="graph-title">
        <div><h2>会議の整理マップ</h2><span>{sourceLabel}</span></div>
        <div className="summary-actions">
          <button type="button" onClick={onBack}>ライブ表示に戻る</button>
          <button type="button" onClick={onRefresh}>再整理</button>
          <button
            type="button"
            className="summary-start-ideas"
            disabled={selectedIdeaItemIds.size === 0}
            onClick={() => onStartIdeaSession([...selectedIdeaItemIds])}
          >
            選択した課題でアイデア出し ({selectedIdeaItemIds.size})
          </button>
        </div>
      </div>
      {stale ? <p className="summary-stale">新しい発言があります。再整理すると反映されます。</p> : null}
      {error ? <p className="summary-error">{error}</p> : null}
      <OrganizationProgress startedAt={startedAt} status={status} segmentCount={segments.length} />
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.15} maxZoom={1.5} nodesDraggable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={24} color="#e2e7e3" />
        <MapViewportControls fitKey={summary.generatedAt} />
      </ReactFlow>
    </section>
  );
}
