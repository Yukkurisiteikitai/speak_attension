import type { FocusRelation, GraphTopicNodeData, MeetingGraph, TopicEdge, TopicEdgeType, TopicGap, TopicGraphEdge, TopicGraphNode, TopicNode, UtteranceIntent } from "../types/topic";
import { createEmptyCoverage } from "./topicCoverage";

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

function nodePosition(index: number): { x: number; y: number } {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 180 + column * 300,
    y: 120 + row * 180,
  };
}

function gapPosition(index: number, parentY: number): { x: number; y: number } {
  return {
    x: 1040,
    y: parentY + index * 88,
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

  topicNodes.forEach((node, index) => {
    const position = nodePosition(index);
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

  groupedGaps.forEach((gaps, topicId) => {
    const topicPosition = nodeIndexMap.get(topicId) ?? { x: 700, y: 200 };
    gaps.forEach((gap, index) => {
      flowNodes.push({
        id: gap.id,
        type: "topic",
        position: gapPosition(index, topicPosition.y - 24),
        data: {
          label: gap.title,
          kind: "gap",
          states: ["missing"],
          detail: gap.detail,
          isActive: false,
        },
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
