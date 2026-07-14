import type { FocusRelation, GraphTopicNodeData, MeetingGraph, TopicEdge, TopicEdgeType, TopicGap, TopicGraphEdge, TopicGraphNode, TopicNode, UtteranceIntent } from "../types/topic";
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

// Cumulative-height topic grid layout: 3 columns, positions nodes by their index
// tracking cumulative height per column to avoid overlaps
function createTopicNodePositioner(topics: TopicNode[], dataMap: Map<string, GraphTopicNodeData>) {
  const COLS = 3;
  const X_SPACING = 300;
  const INITIAL_X = 180;
  const INITIAL_Y = 120;

  const colHeights: number[] = [INITIAL_Y, INITIAL_Y, INITIAL_Y];
  const positions = new Map<string, { x: number; y: number; height: number }>();

  topics.forEach((topic, index) => {
    const col = index % COLS;
    const x = INITIAL_X + col * X_SPACING;
    const y = colHeights[col];

    const data = dataMap.get(topic.id) ?? { label: topic.title, kind: "topic" as const, states: [] };
    const height = estimateTopicNodeHeight(data);

    positions.set(topic.id, { x, y, height });
    colHeights[col] = y + height + 16; // 16px gap between nodes
  });

  return positions;
}

function nodePosition(index: number, topicId: string, positionMap: Map<string, { x: number; y: number; height: number }>): { x: number; y: number } {
  const pos = positionMap.get(topicId);
  if (pos) {
    return { x: pos.x, y: pos.y };
  }
  // Fallback to grid layout if positionMap doesn't have this topic
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 180 + column * 300,
    y: 120 + row * 180,
  };
}

// Global y-cursor for gap column layout, grouped by topic to guarantee structural zero overlap
function createGapPositioner() {
  const GAP_COLUMN_X = 1100;
  const topicGapMap = new Map<string, number[]>();
  let globalYCursor = 120;

  const addGapForTopic = (topicId: string, topicY: number, gapData: GraphTopicNodeData): number => {
    if (!topicGapMap.has(topicId)) {
      topicGapMap.set(topicId, []);
      globalYCursor = Math.max(globalYCursor, topicY);
    }
    const positions = topicGapMap.get(topicId)!;
    const gapY = globalYCursor;
    positions.push(gapY);
    const gapHeight = estimateTopicNodeHeight(gapData);
    globalYCursor += gapHeight + 16; // gap node height + margin
    return gapY;
  };

  return { GAP_COLUMN_X, addGapForTopic };
}

function gapPosition(index: number, topicId: string, topicY: number, gapData: GraphTopicNodeData, gapPositioner: ReturnType<typeof createGapPositioner>): { x: number; y: number } {
  const y = gapPositioner.addGapForTopic(topicId, topicY, gapData);
  return {
    x: gapPositioner.GAP_COLUMN_X,
    y,
  };
}

export function projectGraphToFlow(input: {
  graph: MeetingGraph;
  currentTopicId: string | null;
  evidenceByTopicId: Map<string, string>;
}): { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] } {
  const topicNodes = input.graph.nodes.filter((node) => node.id !== input.graph.rootTopicId);
  const nodeIndexMap = new Map<string, { x: number; y: number }>();

  const rootNode: TopicGraphNode = {
    id: input.graph.rootTopicId,
    type: "topic",
    position: { x: 520, y: 20 },
    data: {
      label: input.graph.title,
      kind: "root",
      states: ["discussed"],
      detail: "meeting root",
      isActive: false,
    } satisfies GraphTopicNodeData,
  };

  const flowNodes: TopicGraphNode[] = [rootNode];

  // Build data map for height estimation
  const dataMap = new Map<string, GraphTopicNodeData>();
  topicNodes.forEach((node) => {
    dataMap.set(node.id, {
      label: node.title,
      kind: "topic",
      states: node.displayStates,
      lifecycle: node.lifecycle,
      mentionCount: node.mentionCount,
      evidence: undefined,
      isActive: node.id === input.currentTopicId,
    });
  });

  // Create topic node positioner for cumulative height layout
  const topicPositions = createTopicNodePositioner(topicNodes, dataMap);

  topicNodes.forEach((node, index) => {
    const posData = topicPositions.get(node.id);
    const position = { x: posData?.x ?? 180, y: posData?.y ?? 120 };
    nodeIndexMap.set(node.id, position);
    flowNodes.push({
      id: node.id,
      type: "topic",
      position,
      data: {
        label: node.title,
        kind: "topic",
        states: node.displayStates,
        lifecycle: node.lifecycle,
        mentionCount: node.mentionCount,
        evidence: input.evidenceByTopicId.get(node.id),
        isActive: node.id === input.currentTopicId,
      },
    });
  });

  const flowEdges: TopicGraphEdge[] = input.graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "default",
    data: {
      relation: edge.type,
    },
  }));

  const groupedGaps = new Map<string, TopicGap[]>();
  input.graph.gaps.forEach((gap) => {
    if (gap.closedAt) return;
    const items = groupedGaps.get(gap.topicId) ?? [];
    items.push(gap);
    groupedGaps.set(gap.topicId, items);
  });

  const gapPositioner = createGapPositioner();

  groupedGaps.forEach((gaps, topicId) => {
    const topicPosition = nodeIndexMap.get(topicId) ?? { x: 700, y: 200 };
    gaps.forEach((gap, index) => {
      const gapData: GraphTopicNodeData = {
        label: gap.title,
        kind: "gap",
        states: ["missing"],
        detail: gap.detail,
        isActive: false,
      };
      const position = gapPosition(index, topicId, topicPosition.y, gapData, gapPositioner);
      flowNodes.push({
        id: gap.id,
        type: "topic",
        position,
        data: gapData,
      });
      flowEdges.push({
        id: `${gap.id}-edge`,
        source: topicId,
        target: gap.id,
        type: "default",
        data: {
          relation: "missing_of",
        },
      });
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
