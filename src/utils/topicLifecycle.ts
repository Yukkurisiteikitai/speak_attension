import type { AnalyzedSegment, CoverageUpdate, FocusState, ImportantMention, MeetingGraph, TopicNode } from "../types/topic";
import { detectUtteranceIntent, mapIntentToImportanceType } from "./intentRules";
import { buildTopicGaps, deriveDisplayStates, deriveLifecycle, sortGaps } from "./topicCoverage";
import { createId } from "./topicProjection";

const CLOSE_AFTER_SEGMENTS = 2;
const CLOSE_AFTER_MS = 15_000;

function getTopicById(graph: MeetingGraph, topicId: string | null): TopicNode | null {
  if (!topicId) return null;
  return graph.nodes.find((node) => node.id === topicId) ?? null;
}

function updateTopicNode(graph: MeetingGraph, topicId: string, update: (node: TopicNode) => TopicNode): MeetingGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === topicId ? update(node) : node)),
  };
}

export function updateCoverage(node: TopicNode, coverageUpdates: CoverageUpdate[], text: string): TopicNode {
  const nextCoverage = { ...node.coverage };
  let nextOpenQuestionCount = node.openQuestionCount;

  for (const update of coverageUpdates) {
    if (update.key === "openQuestionResolved") {
      if (text.includes("決定") || text.includes("結論") || text.includes("方針")) {
        nextCoverage.openQuestionResolved = true;
        nextOpenQuestionCount = 0;
      } else {
        nextOpenQuestionCount += 1;
        nextCoverage.openQuestionResolved = false;
      }
      continue;
    }

    nextCoverage[update.key] = true;
  }

  if (nextCoverage.decision && text.includes("なぜ")) {
    nextCoverage.openQuestionResolved = false;
    nextOpenQuestionCount += 1;
  }

  if ((nextCoverage.decision || nextCoverage.nextAction) && text.includes("これでいく")) {
    nextCoverage.openQuestionResolved = true;
    nextOpenQuestionCount = 0;
  }

  return {
    ...node,
    coverage: nextCoverage,
    openQuestionCount: nextOpenQuestionCount,
  };
}

export function refreshTopicDerivedState(graph: MeetingGraph, topicId: string): MeetingGraph {
  const topic = getTopicById(graph, topicId);
  if (!topic) return graph;
  const topicGaps = graph.gaps.filter((gap) => gap.topicId === topicId && !gap.closedAt);
  const unresolved = topic.openQuestionCount > 0 && !topic.coverage.openQuestionResolved;
  const lifecycle = deriveLifecycle(topic, unresolved);
  const displayStates = deriveDisplayStates(topic, topicGaps, unresolved);
  return updateTopicNode(graph, topicId, (node) => ({
    ...node,
    lifecycle,
    displayStates,
  }));
}

export function closeDormantTopics(graph: MeetingGraph, activeTopicId: string | null, now: number, segmentIndex: number): { graph: MeetingGraph; newlyClosedTopicIds: string[] } {
  let nextGraph = graph;
  const newlyClosedTopicIds: string[] = [];

  for (const topic of graph.nodes) {
    if (topic.id === graph.rootTopicId || topic.id === activeTopicId || topic.closedAt) continue;
    if (!topic.lastActivatedAt) continue;

    const quietBySegments = segmentIndex - topic.lastActivatedSegmentIndex >= CLOSE_AFTER_SEGMENTS;
    const quietByTime = now - topic.lastActivatedAt >= CLOSE_AFTER_MS;
    if (!quietBySegments && !quietByTime) continue;

    newlyClosedTopicIds.push(topic.id);

    const gaps = buildTopicGaps(topic, topic.openQuestionCount > 0 && !topic.coverage.openQuestionResolved, now);
    const lifecycle = deriveLifecycle(topic, topic.openQuestionCount > 0 && !topic.coverage.openQuestionResolved);
    const displayStates = deriveDisplayStates(topic, gaps, topic.openQuestionCount > 0 && !topic.coverage.openQuestionResolved);

    nextGraph = {
      ...nextGraph,
      nodes: nextGraph.nodes.map((node) =>
        node.id === topic.id
          ? {
              ...node,
              lifecycle,
              displayStates,
              closedAt: now,
              lastActivatedAt: null,
            }
          : node,
      ),
      gaps: [...nextGraph.gaps.filter((gap) => gap.topicId !== topic.id), ...gaps],
    };
  }

  return {
    graph: {
      ...nextGraph,
      gapSummary: {
        gaps: sortGaps(nextGraph.gaps.filter((gap) => !gap.closedAt)),
        updatedAt: nextGraph.gaps.length ? now : nextGraph.gapSummary.updatedAt,
      },
    },
    newlyClosedTopicIds,
  };
}

export function createImportantMention(
  segmentId: string,
  text: string,
  selectedTopicId: string | null,
  confidence: number,
): ImportantMention | null {
  const type = mapIntentToImportanceType(detectUtteranceIntent(text));
  if (!type) return null;
  return {
    id: createId("mention"),
    segmentId,
    text,
    type,
    relatedTopicId: selectedTopicId,
    confidence,
  };
}

export function projectState(graph: MeetingGraph, currentTopicId: string | null, segments: AnalyzedSegment[], projectGraphToFlow: (input: {
  graph: MeetingGraph;
  currentTopicId: string | null;
  evidenceByTopicId: Map<string, string>;
  segments?: AnalyzedSegment[];
}) => { nodes: AnalyzedSegment extends never ? never : import("../types/topic").TopicGraphNode[]; edges: import("../types/topic").TopicGraphEdge[] }): {
  nodes: import("../types/topic").TopicGraphNode[];
  edges: import("../types/topic").TopicGraphEdge[];
} {
  const evidenceByTopicId = new Map<string, string>();
  segments.forEach((segment) => {
    segment.matchedTopicIds.forEach((topicId) => {
      if (!evidenceByTopicId.has(topicId)) evidenceByTopicId.set(topicId, segment.text);
    });
  });
  return projectGraphToFlow({
    graph,
    currentTopicId,
    evidenceByTopicId,
    segments,
  });
}

export function getTopicLabel(graph: MeetingGraph, topicId: string | null): string | null {
  return getTopicById(graph, topicId)?.title ?? null;
}
