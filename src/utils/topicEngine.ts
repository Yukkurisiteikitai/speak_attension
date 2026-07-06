import type {
  AnalyzedSegment,
  ConversationContext,
  FocusState,
  ImportantMention,
  TopicDecisionLog,
  TopicGraphEdge,
  TopicGraphNode,
  TranscriptInputSource,
} from "../types/topic";
import {
  INITIAL_TOPIC_EDGES,
  INITIAL_TOPIC_NODES,
  buildUnknownTopicLabel,
  createId,
  scoreTopicBreakdown,
  sortTopicScores,
} from "./topicRules";
import { resolveReferences } from "./contextResolver";
import { evaluateFocusGate } from "./focusGate";
import { detectUtteranceIntent } from "./intentRules";

const HEAT_INCREMENT = 0.25;
const ADJACENT_HEAT_INCREMENT = 0.1;
const UNKNOWN_MIN_LENGTH = 20;
const UNKNOWN_DUPLICATE_WINDOW_MS = 60_000;
const REFERENCE_CONFIDENCE_THRESHOLD = 0.6;

export type TopicEngineState = {
  nodes: TopicGraphNode[];
  edges: TopicGraphEdge[];
  segments: AnalyzedSegment[];
  currentTopicId: string | null;
  focusState: FocusState;
  decisionLogs: TopicDecisionLog[];
  importantMentions: ImportantMention[];
};

export type TopicEngineTransition = {
  state: TopicEngineState;
  segment: AnalyzedSegment;
  decisionLog: TopicDecisionLog;
  importantMention: ImportantMention | null;
};

function cloneInitialNodes(): TopicGraphNode[] {
  return INITIAL_TOPIC_NODES.map((node) => ({
    ...node,
    position: { ...node.position },
    data: {
      ...node.data,
      keywords: [...node.data.keywords],
      normalizedTerms: [...node.data.normalizedTerms],
      evidence: [],
    },
  }));
}

function cloneInitialEdges(): TopicGraphEdge[] {
  return INITIAL_TOPIC_EDGES.map((edge) => ({ ...edge }));
}

function limitEvidence(evidence: string[], nextText: string): string[] {
  return [nextText, ...evidence.filter((item) => item !== nextText)].slice(0, 5);
}

function findUnknownDuplicate(nodes: TopicGraphNode[], text: string, now: number): TopicGraphNode | null {
  const label = buildUnknownTopicLabel(text);
  const prefix = label.slice(0, 12);
  return (
    nodes.find((node) => {
      if (!node.id.startsWith("custom-")) return false;
      if (!node.data.lastTouchedAt || now - node.data.lastTouchedAt > UNKNOWN_DUPLICATE_WINDOW_MS) return false;
      return node.data.label.slice(0, 12) === prefix;
    }) ?? null
  );
}

function nextCustomPosition(nodes: TopicGraphNode[]) {
  const customCount = nodes.filter((node) => node.id.startsWith("custom-")).length;
  return {
    x: 900,
    y: 220 + customCount * 112,
  };
}

export function getTopicLabel(nodes: TopicGraphNode[], topicId: string | null): string | null {
  if (!topicId) return null;
  return nodes.find((node) => node.id === topicId)?.data.label ?? null;
}

function touchNodes(nodes: TopicGraphNode[], topicIds: string[], text: string, now: number, increment: number): TopicGraphNode[] {
  const uniqueTopicIds = [...new Set(topicIds)];
  if (uniqueTopicIds.length === 0) return nodes;
  return nodes.map((node) => {
    if (!uniqueTopicIds.includes(node.id)) return node;
    return {
      ...node,
      data: {
        ...node.data,
        heat: Math.min(1, Number((node.data.heat + increment).toFixed(2))),
        lastTouchedAt: now,
        evidence: limitEvidence(node.data.evidence, text),
      },
    };
  });
}

export function createInitialTopicEngineState(now = Date.now()): TopicEngineState {
  return {
    nodes: cloneInitialNodes(),
    edges: cloneInitialEdges(),
    segments: [],
    currentTopicId: null,
    focusState: {
      focusTopicId: null,
      focusLabel: null,
      focusSetBy: "auto",
      locked: false,
      startedAt: now,
    },
    decisionLogs: [],
    importantMentions: [],
  };
}

export function setManualFocusState(state: TopicEngineState, topicId: string | null, now = Date.now()): TopicEngineState {
  const nextFocusState: FocusState = {
    ...state.focusState,
    focusTopicId: topicId,
    focusLabel: getTopicLabel(state.nodes, topicId),
    focusSetBy: "manual",
    startedAt: now,
  };

  return {
    ...state,
    currentTopicId: topicId,
    focusState: nextFocusState,
  };
}

export function setFocusLockedState(state: TopicEngineState, locked: boolean): TopicEngineState {
  return {
    ...state,
    focusState: {
      ...state.focusState,
      locked,
    },
  };
}

export function processTopicSegment(
  state: TopicEngineState,
  text: string,
  source: TranscriptInputSource,
  now = Date.now(),
): TopicEngineTransition {
  const intent = detectUtteranceIntent(text);
  const context: ConversationContext = {
    activeTopicId: state.currentTopicId,
    recentTopicIds: state.segments.flatMap((segment) => segment.matchedTopicIds).slice(0, 8),
    recentSegments: state.segments.slice(0, 8),
  };
  const references = resolveReferences(text, context);
  const unresolvedReferences = references
    .filter((reference) => reference.confidence < REFERENCE_CONFIDENCE_THRESHOLD || !reference.candidateTopicId)
    .map((reference) => reference.phrase);
  const confidentReferences = references.filter(
    (reference) => reference.confidence >= REFERENCE_CONFIDENCE_THRESHOLD && reference.candidateTopicId,
  );
  const topicScores = sortTopicScores(
    state.nodes.map((node, index) => ({
      ...scoreTopicBreakdown({
        text,
        node,
        focusState: state.focusState,
        intent,
        now,
      }),
      index,
    })),
  )
    .filter((item) => item.total > 0)
    .map(({ index: _index, ...score }) => score);

  const matchedKeywords = [...new Set(topicScores.flatMap((item) => item.matchedKeywords))];
  const matchedSynonyms = [...new Set(topicScores.flatMap((item) => item.matchedSynonyms))];
  const matchedTopicIds = topicScores.map((item) => item.topicId);
  const selectedTopicId = topicScores[0]?.topicId ?? null;
  const selectedTopicLabel = getTopicLabel(state.nodes, selectedTopicId);
  const focusGate = evaluateFocusGate({
    text,
    focusState: state.focusState,
    intent,
    selectedTopicId,
    matchedTopicIds,
    topicScores,
    resolvedReferences: confidentReferences,
    unresolvedReferences,
    edges: state.edges,
    nodes: state.nodes,
  });
  let activeTopicId = focusGate.shouldUpdateCurrentTopic ? selectedTopicId ?? state.focusState.focusTopicId : state.currentTopicId;
  let nextNodes = state.nodes;
  let nextEdges = state.edges;
  let nextFocusState = state.focusState;
  let createdNodeId: string | null = null;

  if (focusGate.shouldChangeFocus && focusGate.focusChangeCandidateTopicId) {
    const nextFocusTopicId = focusGate.focusChangeCandidateTopicId;
    nextFocusState = {
      ...nextFocusState,
      focusTopicId: nextFocusTopicId,
      focusLabel: getTopicLabel(state.nodes, nextFocusTopicId),
      focusSetBy: "auto",
      startedAt: now,
    };
    activeTopicId = nextFocusTopicId;
  }

  if (focusGate.focusRelation === "on_focus") {
    const topicIdsToTouch = selectedTopicId ? matchedTopicIds : [nextFocusState.focusTopicId].filter(Boolean);
    nextNodes = touchNodes(state.nodes, topicIdsToTouch as string[], text, now, HEAT_INCREMENT);
    activeTopicId = selectedTopicId ?? nextFocusState.focusTopicId;
  } else if (focusGate.focusRelation === "adjacent") {
    nextNodes = touchNodes(state.nodes, matchedTopicIds, text, now, ADJACENT_HEAT_INCREMENT);
  }

  const canCreateUnknownNode =
    matchedTopicIds.length === 0 &&
    text.length >= UNKNOWN_MIN_LENGTH &&
    focusGate.focusRelation !== "off_topic_noise" &&
    focusGate.focusRelation !== "off_topic_important" &&
    unresolvedReferences.length === 0;

  if (canCreateUnknownNode) {
    const duplicate = findUnknownDuplicate(state.nodes, text, now);
    if (duplicate) {
      matchedTopicIds.push(duplicate.id);
      createdNodeId = duplicate.id;
      if (focusGate.focusRelation === "on_focus") activeTopicId = duplicate.id;
      nextNodes = touchNodes(nextNodes, [duplicate.id], text, now, HEAT_INCREMENT);
    } else {
      const id = createId("custom");
      matchedTopicIds.push(id);
      createdNodeId = id;
      if (focusGate.focusRelation === "on_focus") activeTopicId = id;
      const label = buildUnknownTopicLabel(text);
      const customNode: TopicGraphNode = {
        id,
        type: "topic",
        position: nextCustomPosition(state.nodes),
        data: {
          label,
          heat: HEAT_INCREMENT,
          keywords: [label, label.slice(0, 8)].filter(Boolean),
          normalizedTerms: [],
          lastTouchedAt: now,
          evidence: [text],
        },
      };
      nextNodes = [...state.nodes, customNode];
      nextEdges = [
        ...state.edges,
        {
          id: `topic-${id}`,
          source: nextFocusState.focusTopicId ?? state.currentTopicId ?? "topic-detection",
          target: id,
        },
      ];
    }
  }

  const segment: AnalyzedSegment = {
    id: createId("seg"),
    text,
    createdAt: now,
    source,
    matchedTopicIds,
    analysis: {
      selectedTopicId,
      selectedTopicLabel,
      matchedTopicIds,
      matchedKeywords,
      matchedSynonyms,
      intent,
      topicScores,
      focusRelation: focusGate.focusRelation,
      focusAlignmentScore: focusGate.focusAlignmentScore,
      importanceType: focusGate.importanceType,
      resolvedReferences: confidentReferences,
      unresolvedReferences,
      shouldUpdateGraph: focusGate.shouldUpdateGraph,
      shouldUpdateCurrentTopic: focusGate.shouldUpdateCurrentTopic,
      shouldCreateNode: Boolean(createdNodeId),
      reason: focusGate.reason,
    },
  };
  const decisionLog: TopicDecisionLog = {
    segmentId: segment.id,
    text,
    source,
    intent,
    matchedKeywords,
    matchedSynonyms,
    topicScores,
    selectedTopicId,
    unresolvedReferences,
    createdAt: now,
  };
  const importantMention: ImportantMention | null =
    focusGate.focusRelation === "off_topic_important" && focusGate.importanceType
      ? {
          id: createId("mention"),
          segmentId: segment.id,
          text,
          type: focusGate.importanceType,
          relatedTopicId: selectedTopicId,
          confidence: focusGate.focusAlignmentScore,
        }
      : null;

  const nextState: TopicEngineState = {
    ...state,
    nodes: nextNodes,
    edges: nextEdges,
    currentTopicId: activeTopicId,
    focusState: nextFocusState,
    segments: [segment, ...state.segments].slice(0, 60),
    decisionLogs: [decisionLog, ...state.decisionLogs].slice(0, 60),
    importantMentions: importantMention ? [importantMention, ...state.importantMentions].slice(0, 40) : state.importantMentions,
  };

  return {
    state: nextState,
    segment,
    decisionLog,
    importantMention,
  };
}
