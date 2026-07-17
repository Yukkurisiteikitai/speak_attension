import type {
  AnalyzedSegment,
  FocusState,
  ImportantMention,
  MeetingGraph,
  TopicDecisionLog,
  TopicGap,
  TopicGraphEdge,
  TopicGraphNode,
  TopicNode,
  TranscriptInputSource,
} from "../types/topic";
import { detectUtteranceIntent } from "./intentRules";
import { detectCoverageUpdates, sortGaps } from "./topicCoverage";
import { extractTopicPhrases, resolveTopicReference } from "./topicExtraction";
import { closeDormantTopics, createImportantMention, getTopicLabel, projectState, refreshTopicDerivedState, updateCoverage } from "./topicLifecycle";
import { createId, createInitialMeetingGraph, createTopicEdge, getRootTopicId, projectGraphToFlow, relationFromIntent } from "./topicProjection";
import { appendEvidenceSegmentIds, chooseSelectedTopic, createTopicFromPhrase, mergeAliases, mergeAliasStrings } from "./topicSelection";

export type TopicEngineState = {
  meetingGraph: MeetingGraph;
  nodes: TopicGraphNode[];
  edges: TopicGraphEdge[];
  segments: AnalyzedSegment[];
  currentTopicId: string | null;
  focusState: FocusState;
  decisionLogs: TopicDecisionLog[];
  importantMentions: ImportantMention[];
  meetingStartedAt: number;
  segmentCount: number;
};

export type TopicEngineTransition = {
  state: TopicEngineState;
  segment: AnalyzedSegment;
  decisionLog: TopicDecisionLog;
  importantMention: ImportantMention | null;
  newlyClosedTopicIds: string[];
};

// This module is the orchestration layer for one transcript segment.
// It keeps the business rules readable by delegating extraction, scoring, coverage, and lifecycle work to smaller helpers.
function updateTopicNode(graph: MeetingGraph, topicId: string, update: (node: TopicNode) => TopicNode): MeetingGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === topicId ? update(node) : node)),
  };
}

export function createInitialTopicEngineState(now = Date.now()): TopicEngineState {
  const meetingGraph = createInitialMeetingGraph("attension_mindmap v0.1");
  const projection = projectGraphToFlow({
    graph: meetingGraph,
    currentTopicId: null,
    evidenceByTopicId: new Map(),
    segments: [],
  });
  return {
    meetingGraph,
    nodes: projection.nodes,
    edges: projection.edges,
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
    meetingStartedAt: now,
    segmentCount: 0,
  };
}

export function setManualFocusState(state: TopicEngineState, topicId: string | null, now = Date.now()): TopicEngineState {
  const nextCurrentTopicId = topicId ?? state.currentTopicId;
  const nextFocusState: FocusState = {
    ...state.focusState,
    focusTopicId: topicId,
    focusLabel: getTopicLabel(state.meetingGraph, topicId),
    focusSetBy: "manual",
    startedAt: now,
  };
  const projection = projectState(state.meetingGraph, nextCurrentTopicId, state.segments, projectGraphToFlow);

  return {
    ...state,
    currentTopicId: nextCurrentTopicId,
    focusState: nextFocusState,
    nodes: projection.nodes,
    edges: projection.edges,
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

export function applyTopicTitleRefinements(state: TopicEngineState, updates: Map<string, string>, now = Date.now()): TopicEngineState {
  if (updates.size === 0) return state;

  let nextGraph = state.meetingGraph;
  for (const [topicId, newTitle] of updates) {
    const topic = nextGraph.nodes.find((node) => node.id === topicId);
    if (!topic || topic.title === newTitle) continue;

    nextGraph = {
      ...nextGraph,
      nodes: nextGraph.nodes.map((node) =>
        node.id === topicId
          ? {
              ...node,
              title: newTitle,
              aliases: mergeAliasStrings(node.aliases, [node.title]),
            }
          : node,
      ),
    };
  }

  const nextFocusState: FocusState =
    state.focusState.focusTopicId && updates.has(state.focusState.focusTopicId)
      ? {
          ...state.focusState,
          focusLabel: getTopicLabel(nextGraph, state.focusState.focusTopicId),
        }
      : state.focusState;

  const nextCurrentTopicId = state.currentTopicId;
  const projection = projectState(nextGraph, nextCurrentTopicId, state.segments, projectGraphToFlow);

  return {
    ...state,
    meetingGraph: nextGraph,
    focusState: nextFocusState,
    nodes: projection.nodes,
    edges: projection.edges,
  };
}

// Processes one transcript segment and returns the next immutable engine snapshot plus analysis artifacts.
export function processTopicSegment(
  state: TopicEngineState,
  text: string,
  source: TranscriptInputSource,
  now = Date.now(),
): TopicEngineTransition {
  const segmentId = createId("seg");
  const segmentIndex = state.segmentCount + 1;
  const intent = detectUtteranceIntent(text);
  const candidateTopicPhrases = extractTopicPhrases(text);
  const references = resolveTopicReference(text, state.currentTopicId);
  const unresolvedReferences = references.filter((reference) => reference.confidence < 0.6 || !reference.candidateTopicId).map((reference) => reference.phrase);
  const resolvedReferences = references.filter((reference) => reference.confidence >= 0.6 && reference.candidateTopicId);
  const selected = chooseSelectedTopic({
    graph: state.meetingGraph,
    phrases: candidateTopicPhrases,
    currentTopicId: state.currentTopicId,
  });

  let nextGraph = state.meetingGraph;
  let selectedTopicId = selected.selectedTopicId;
  let createdTopicId: string | null = null;

  if (!selectedTopicId && selected.shouldCreateTopic && selected.selectedPhrase) {
    const topic = createTopicFromPhrase(selected.selectedPhrase, segmentId, now, segmentIndex);
    selectedTopicId = topic.id;
    createdTopicId = topic.id;
    nextGraph = {
      ...nextGraph,
      nodes: [...nextGraph.nodes, topic],
      edges: [...nextGraph.edges, createTopicEdge(getRootTopicId(), topic.id, "parent")],
    };
  }

  if (!selectedTopicId && resolvedReferences[0]?.candidateTopicId) {
    selectedTopicId = resolvedReferences[0].candidateTopicId;
  }

  const previousTopicId = state.currentTopicId;
  const nextCurrentTopicId = state.focusState.locked && state.focusState.focusTopicId ? state.focusState.focusTopicId : selectedTopicId ?? state.currentTopicId;
  const coverageUpdates = detectCoverageUpdates(text);

  if (selectedTopicId) {
    nextGraph = updateTopicNode(nextGraph, selectedTopicId, (node) => {
      const updated = updateCoverage(
        {
          ...node,
          aliases: mergeAliases(node.aliases, candidateTopicPhrases),
          evidenceSegmentIds: appendEvidenceSegmentIds(node.evidenceSegmentIds, segmentId),
          mentionCount: node.mentionCount + 1,
          lastSeenAt: now,
          lastActivatedAt: nextCurrentTopicId === node.id ? now : node.lastActivatedAt,
          closedAt: nextCurrentTopicId === node.id ? null : node.closedAt,
          lastActivatedSegmentIndex: nextCurrentTopicId === node.id ? segmentIndex : node.lastActivatedSegmentIndex,
        },
        coverageUpdates,
        text,
      );
      return updated;
    });
    nextGraph = {
      ...nextGraph,
      gaps: nextGraph.gaps.filter((gap) => gap.topicId !== selectedTopicId),
    };
    nextGraph = refreshTopicDerivedState(nextGraph, selectedTopicId);
  }

  const nextFocusState: FocusState =
    state.focusState.locked || !nextCurrentTopicId
      ? state.focusState
      : {
          ...state.focusState,
          focusTopicId: nextCurrentTopicId,
          focusLabel: getTopicLabel(nextGraph, nextCurrentTopicId),
          focusSetBy: "auto",
          startedAt: selectedTopicId && selectedTopicId !== previousTopicId ? now : state.focusState.startedAt,
        };

  const dormancyResult = closeDormantTopics(nextGraph, nextCurrentTopicId, now, segmentIndex);
  nextGraph = dormancyResult.graph;
  const newlyClosedTopicIds = dormancyResult.newlyClosedTopicIds;
  if (selectedTopicId) nextGraph = refreshTopicDerivedState(nextGraph, selectedTopicId);

  const focusRelation = relationFromIntent(intent, selectedTopicId, nextCurrentTopicId);
  const createdGapIds = nextGraph.gaps.filter((gap) => gap.createdAt === now).map((gap) => gap.id);
  const segment: AnalyzedSegment = {
    id: segmentId,
    text,
    createdAt: now,
    source,
    matchedTopicIds: selectedTopicId ? [selectedTopicId] : [],
    analysis: {
      selectedTopicId,
      selectedTopicLabel: getTopicLabel(nextGraph, selectedTopicId),
      matchedTopicIds: selectedTopicId ? [selectedTopicId] : [],
      intent,
      focusRelation,
      focusAlignmentScore: focusRelation === "on_focus" ? 1 : focusRelation === "adjacent" ? 0.65 : focusRelation === "off_topic_important" ? 0.35 : focusRelation === "off_topic_noise" ? 0.1 : 0.25,
      candidateTopicPhrases,
      topicScores: selected.selectedScores,
      resolvedReferences,
      unresolvedReferences,
      shouldUpdateGraph: Boolean(selectedTopicId || createdTopicId),
      shouldUpdateCurrentTopic: Boolean(nextCurrentTopicId),
      shouldCreateNode: Boolean(createdTopicId),
      coverageUpdates,
      createdGapIds,
      reason: createdTopicId
        ? "new meeting topic created from transcript phrase"
        : selectedTopicId
          ? "matched against existing meeting topic"
          : "no stable topic match",
    },
  };

  const decisionLog: TopicDecisionLog = {
    segmentId,
    text,
    source,
    intent,
    topicScores: selected.selectedScores,
    selectedTopicId,
    unresolvedReferences,
    coverageUpdates,
    createdAt: now,
  };
  const importantMention = createImportantMention(segmentId, text, selectedTopicId, segment.analysis.focusAlignmentScore);
  const nextSegments = [segment, ...state.segments].slice(0, 80);
  const projection = projectState(nextGraph, nextCurrentTopicId, nextSegments, projectGraphToFlow);

  return {
    state: {
      ...state,
      meetingGraph: {
        ...nextGraph,
        gapSummary: {
          gaps: sortGaps(nextGraph.gaps.filter((gap) => !gap.closedAt)),
          updatedAt: nextGraph.gapSummary.updatedAt ?? now,
        },
      },
      nodes: projection.nodes,
      edges: projection.edges,
      currentTopicId: nextCurrentTopicId,
      focusState: nextFocusState,
      segments: nextSegments,
      decisionLogs: [decisionLog, ...state.decisionLogs].slice(0, 80),
      importantMentions: importantMention ? [importantMention, ...state.importantMentions].slice(0, 40) : state.importantMentions,
      segmentCount: segmentIndex,
    },
    segment,
    decisionLog,
    importantMention,
    newlyClosedTopicIds,
  };
}

export function getCurrentTopicGaps(state: TopicEngineState): TopicGap[] {
  if (!state.currentTopicId) return [];
  return state.meetingGraph.gaps.filter((gap) => gap.topicId === state.currentTopicId && !gap.closedAt);
}
