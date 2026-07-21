import type { AnalyzedSegment, FocusRelation, GraphTopicNodeData, MeetingGraph, TopicEdge, TopicEdgeType, TopicGraphEdge, TopicGraphNode, TopicNode, UtteranceIntent } from "../types/topic";
import { createEmptyCoverage } from "./topicCoverage";
import { estimateTextWidth } from "./textMetrics";

const ROOT_TOPIC_ID = "meeting-root";
const ROOT_TITLE = "Meeting";

export function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createInitialMeetingGraph(title = "Untitled meeting"): MeetingGraph {
  return {
    meetingId: createId("meeting"),
    title,
    rootTopicId: ROOT_TOPIC_ID,
    nodes: [
      {
        id: ROOT_TOPIC_ID,
        title: ROOT_TITLE,
        aliases: [ROOT_TITLE],
        lifecycle: "discussed",
        displayStates: ["discussed"],
        coverage: createEmptyCoverage(),
        evidenceSegmentIds: [],
        mentionCount: 0,
        openQuestionCount: 0,
        firstSeenAt: 0,
        lastSeenAt: 0,
        lastActivatedAt: null,
        closedAt: null,
        lastActivatedSegmentIndex: -1,
      },
    ],
    edges: [],
    gaps: [],
    gapSummary: {
      gaps: [],
      updatedAt: null,
    },
  };
}

export function getRootTopicId(): string {
  return ROOT_TOPIC_ID;
}

// Estimate the height of a topic node based on its data
export function estimateTopicNodeHeight(data: GraphTopicNodeData): number {
  if (data.kind === "utterance") {
    const contentWidth = 280;
    const lineCount = Math.max(1, Math.ceil(estimateTextWidth(data.label, 13) / contentWidth));
    return 48 + lineCount * 19;
  }

  const TITLE_FONT_SIZE = 14;
  const META_FONT_SIZE = 12;
  const CONTENT_WIDTH = 234; // approximate px
  const LIFECYCLE_HEIGHT = 35;
  const BADGE_HEIGHT = 24;
  const PADDING_BORDER = 26; // top + bottom padding + border

  // Conservative line heights (slightly over-estimated for safety)
  const TITLE_LINE_HEIGHT = 22;
  const META_LINE_HEIGHT = 20;

  const titleLines = Math.ceil(estimateTextWidth(data.label, TITLE_FONT_SIZE) / CONTENT_WIDTH);
  const titleHeight = titleLines * TITLE_LINE_HEIGHT;

  let contentHeight = titleHeight + 8; // gap after title

  if (data.evidence) {
    const metaLines = Math.ceil(estimateTextWidth(data.evidence, META_FONT_SIZE) / CONTENT_WIDTH);
    contentHeight += metaLines * META_LINE_HEIGHT + 8;
  }

  if (data.lifecycle) {
    contentHeight += LIFECYCLE_HEIGHT + 8;
  }

  if (data.states && data.states.length > 0) {
    contentHeight += BADGE_HEIGHT;
  }

  const totalHeight = Math.max(120, contentHeight + PADDING_BORDER);
  return Math.ceil(totalHeight * 1.2); // Extra 20% buffer for CSS rendering variations
}

const ROOT_WIDTH = 300;
const TOPIC_WIDTH = 270;
const UTTERANCE_WIDTH = 320;
const ROOT_X = -ROOT_WIDTH / 2;
const INITIAL_Y = 80;
const BRANCH_GAP = 42;
const UTTERANCE_GAP = 14;
const ROOT_HEIGHT = 122;
const ROOT_TO_TOPIC_GAP = 160;
const TOPIC_TO_UTTERANCE_GAP = 110;

type BranchSide = NonNullable<GraphTopicNodeData["branchSide"]>;

type ProjectedTopicBranch = {
  node: TopicNode;
  topicData: GraphTopicNodeData;
  topicHeight: number;
  visibleSegments: AnalyzedSegment[];
  utteranceHeights: number[];
  utteranceBlockHeight: number;
  branchHeight: number;
  side: BranchSide;
};

function sourceLabel(source: AnalyzedSegment["source"]): string {
  if (source === "speech") return "音声";
  if (source === "replay") return "リプレイ";
  return "手入力";
}

export function summarizeTranscriptForMindmap(text: string, maxLength = 58): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function segmentsByTopicId(segments: AnalyzedSegment[]): Map<string, AnalyzedSegment[]> {
  const grouped = new Map<string, AnalyzedSegment[]>();
  // Engine state is newest-first. Reverse first so same-millisecond input still
  // keeps its original conversation order when the timestamp tie is stable.
  const chronological = [...segments].reverse().sort((left, right) => left.createdAt - right.createdAt);
  chronological.forEach((segment) => {
    segment.matchedTopicIds.forEach((topicId) => {
      const topicSegments = grouped.get(topicId) ?? [];
      topicSegments.push(segment);
      grouped.set(topicId, topicSegments);
    });
  });
  return grouped;
}

export function projectGraphToFlow(input: {
  graph: MeetingGraph;
  currentTopicId: string | null;
  evidenceByTopicId: Map<string, string>;
  segments?: AnalyzedSegment[];
  collapsedTopicIds?: ReadonlySet<string>;
}): { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] } {
  const topicNodes = input.graph.nodes.filter((node) => node.id !== input.graph.rootTopicId);
  const topicSegments = segmentsByTopicId(input.segments ?? []);
  const collapsedTopicIds = input.collapsedTopicIds ?? new Set<string>();

  const rootNode: TopicGraphNode = {
    id: input.graph.rootTopicId,
    type: "topic",
    position: { x: ROOT_X, y: INITIAL_Y },
    data: {
      label: input.graph.title,
      kind: "root",
      states: ["discussed"],
      detail: "meeting root",
      isActive: false,
    } satisfies GraphTopicNodeData,
  };

  const flowNodes: TopicGraphNode[] = [rootNode];
  const flowEdges: TopicGraphEdge[] = [];
  const branches: ProjectedTopicBranch[] = topicNodes.map((node) => {
    const branchSegments = topicSegments.get(node.id) ?? [];
    const isCollapsed = collapsedTopicIds.has(node.id);
    const visibleSegments = isCollapsed ? [] : branchSegments;
    const topicData: GraphTopicNodeData = {
      label: node.title,
      kind: "topic",
      states: node.displayStates,
      lifecycle: node.lifecycle,
      mentionCount: node.mentionCount,
      evidence: input.evidenceByTopicId.get(node.id),
      isActive: node.id === input.currentTopicId,
      topicId: node.id,
      childCount: branchSegments.length,
      isCollapsed,
    };
    const topicHeight = estimateTopicNodeHeight(topicData);
    const utteranceHeights = visibleSegments.map((segment) =>
      estimateTopicNodeHeight({ label: summarizeTranscriptForMindmap(segment.text), kind: "utterance", states: [] }),
    );
    const utteranceBlockHeight = utteranceHeights.reduce((sum, height, index) => sum + height + (index ? UTTERANCE_GAP : 0), 0);
    const branchHeight = Math.max(topicHeight, utteranceBlockHeight);

    return {
      node,
      topicData,
      topicHeight,
      visibleSegments,
      utteranceHeights,
      utteranceBlockHeight,
      branchHeight,
      side: "right",
    };
  });

  const sideHeights: Record<BranchSide, number> = { left: 0, right: 0 };
  for (const branch of branches) {
    const side: BranchSide = sideHeights.right <= sideHeights.left ? "right" : "left";
    branch.side = side;
    sideHeights[side] += (sideHeights[side] > 0 ? BRANCH_GAP : 0) + branch.branchHeight;
  }

  const mapHeight = Math.max(ROOT_HEIGHT, sideHeights.left, sideHeights.right);
  const centerY = INITIAL_Y + mapHeight / 2;
  rootNode.position.y = centerY - ROOT_HEIGHT / 2;

  for (const side of ["left", "right"] as const) {
    const sideBranches = branches.filter((branch) => branch.side === side);
    let cursorY = centerY - sideHeights[side] / 2;

    for (const branch of sideBranches) {
      const { node, topicData, topicHeight, visibleSegments, utteranceHeights, utteranceBlockHeight, branchHeight } = branch;
      const topicY = cursorY + (branchHeight - topicHeight) / 2;
      const utteranceStartY = cursorY + (branchHeight - utteranceBlockHeight) / 2;
      const topicX = side === "right"
        ? ROOT_X + ROOT_WIDTH + ROOT_TO_TOPIC_GAP
        : ROOT_X - ROOT_TO_TOPIC_GAP - TOPIC_WIDTH;
      const utteranceX = side === "right"
        ? topicX + TOPIC_WIDTH + TOPIC_TO_UTTERANCE_GAP
        : topicX - TOPIC_TO_UTTERANCE_GAP - UTTERANCE_WIDTH;

      topicData.branchSide = side;
      flowNodes.push({
        id: node.id,
        type: "topic",
        position: { x: topicX, y: topicY },
        data: topicData,
        draggable: false,
      });
      flowEdges.push({
        id: `${input.graph.rootTopicId}-parent-${node.id}`,
        source: input.graph.rootTopicId,
        sourceHandle: `parent-${side}`,
        target: node.id,
        targetHandle: "parent",
        type: "smoothstep",
        data: { relation: "parent" },
      });

      let utteranceY = utteranceStartY;
      visibleSegments.forEach((segment, index) => {
        const label = summarizeTranscriptForMindmap(segment.text);
        const utteranceHeight = utteranceHeights[index];
        const utteranceNodeId = `utterance-${node.id}-${segment.id}`;
        flowNodes.push({
          id: utteranceNodeId,
          type: "topic",
          position: { x: utteranceX, y: utteranceY },
          data: {
            label,
            kind: "utterance",
            states: [],
            sequence: index + 1,
            sourceLabel: sourceLabel(segment.source),
            topicId: node.id,
            branchSide: side,
          },
          draggable: false,
        });
        flowEdges.push({
          id: `${node.id}-utterance-${segment.id}`,
          source: node.id,
          sourceHandle: "utterances",
          target: utteranceNodeId,
          targetHandle: "parent",
          type: "smoothstep",
          data: { relation: "utterance" },
        });
        utteranceY += utteranceHeight + UTTERANCE_GAP;
      });
      cursorY += branchHeight + BRANCH_GAP;
    }
  }

  // Extra relations are preserved when the engine explicitly has evidence for them.
  input.graph.edges
    .filter((edge) => edge.type !== "parent")
    .forEach((edge) => {
      flowEdges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        data: { relation: edge.type },
      });
    });

  return { nodes: flowNodes, edges: flowEdges };
}

function isNoiseIntent(intent: UtteranceIntent): boolean {
  return intent === "agreement";
}

export function relationFromIntent(intent: UtteranceIntent, selectedTopicId: string | null, activeTopicId: string | null): FocusRelation {
  if (isNoiseIntent(intent) && !selectedTopicId) return "off_topic_noise";
  if (selectedTopicId && selectedTopicId === activeTopicId) return "on_focus";
  if (intent === "switch_topic" && selectedTopicId) return "on_focus";
  if (selectedTopicId) return "adjacent";
  if (intent === "question" || intent === "concern" || intent === "todo") return "off_topic_important";
  return "uncertain";
}

export function createTopicEdge(source: string, target: string, type: TopicEdgeType): TopicEdge {
  return {
    id: `${source}-${type}-${target}`,
    source,
    target,
    type,
  };
}
