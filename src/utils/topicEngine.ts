import type {
  AnalyzedSegment,
  CoverageUpdate,
  FocusState,
  ImportantMention,
  MeetingGraph,
  TopicDecisionLog,
  TopicGap,
  TopicGraphEdge,
  TopicGraphNode,
  TopicNode,
  TopicPhraseCandidate,
  TranscriptInputSource,
} from "../types/topic";
import { detectUtteranceIntent, mapIntentToImportanceType } from "./intentRules";
import {
  buildTopicGaps,
  createEmptyCoverage,
  createId,
  createInitialMeetingGraph,
  createTopicEdge,
  deriveDisplayStates,
  deriveLifecycle,
  detectCoverageUpdates,
  extractTopicPhrases,
  getRootTopicId,
  normalizeForMatch,
  projectGraphToFlow,
  relationFromIntent,
  resolveTopicReference,
  scoreTopicMatch,
  sortGaps,
} from "./topicRules";

const TOPIC_MATCH_THRESHOLD = 0.5;
const CLOSE_AFTER_SEGMENTS = 2;
const CLOSE_AFTER_MS = 15_000;

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
};

function getTopicById(graph: MeetingGraph, topicId: string | null): TopicNode | null {
  if (!topicId) return null;
  return graph.nodes.find((node) => node.id === topicId) ?? null;
}

export function getTopicLabel(graph: MeetingGraph, topicId: string | null): string | null {
  return getTopicById(graph, topicId)?.title ?? null;
}

function updateTopicNode(graph: MeetingGraph, topicId: string, update: (node: TopicNode) => TopicNode): MeetingGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === topicId ? update(node) : node)),
  };
}

function appendEvidenceSegmentIds(current: string[], segmentId: string): string[] {
  return [segmentId, ...current.filter((id) => id !== segmentId)].slice(0, 8);
}

function mergeAliases(current: string[], phrases: TopicPhraseCandidate[]): string[] {
  const next = new Set(current);
  phrases.forEach((phrase) => next.add(normalizeForMatch(phrase.phrase)));
  return [...next].filter(Boolean).slice(0, 8);
}

function createTopicFromPhrase(phrase: TopicPhraseCandidate, segmentId: string, now: number, segmentIndex: number): TopicNode {
  return {
    id: createId("topic"),
    title: phrase.phrase,
    aliases: [normalizeForMatch(phrase.phrase), ...extractTopicPhrases(phrase.clause).map((item) => normalizeForMatch(item.phrase))].slice(0, 6),
    lifecycle: "active",
    displayStates: ["active"],
    coverage: createEmptyCoverage(),
    evidenceSegmentIds: [segmentId],
    mentionCount: 1,
    openQuestionCount: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    lastActivatedAt: now,
    closedAt: null,
    lastActivatedSegmentIndex: segmentIndex,
  };
}

function updateCoverage(node: TopicNode, coverageUpdates: CoverageUpdate[], text: string): TopicNode {
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

function closeDormantTopics(graph: MeetingGraph, activeTopicId: string | null, now: number, segmentIndex: number): MeetingGraph {
  let nextGraph = graph;

  for (const topic of graph.nodes) {
    if (topic.id === graph.rootTopicId || topic.id === activeTopicId || topic.closedAt) continue;
    if (!topic.lastActivatedAt) continue;

    const quietBySegments = segmentIndex - topic.lastActivatedSegmentIndex >= CLOSE_AFTER_SEGMENTS;
    const quietByTime = now - topic.lastActivatedAt >= CLOSE_AFTER_MS;
    if (!quietBySegments && !quietByTime) continue;

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
    ...nextGraph,
    gapSummary: {
      gaps: sortGaps(nextGraph.gaps.filter((gap) => !gap.closedAt)),
      updatedAt: nextGraph.gaps.length ? now : nextGraph.gapSummary.updatedAt,
    },
  };
}

function refreshTopicDerivedState(graph: MeetingGraph, topicId: string): MeetingGraph {
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

function createImportantMention(
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

function chooseSelectedTopic(input: {
  graph: MeetingGraph;
  phrases: TopicPhraseCandidate[];
  currentTopicId: string | null;
}): {
  selectedTopicId: string | null;
  selectedScores: ReturnType<typeof scoreTopicMatch>[];
  shouldCreateTopic: boolean;
  selectedPhrase: TopicPhraseCandidate | null;
} {
  const topicNodes = input.graph.nodes.filter((node) => node.id !== input.graph.rootTopicId);
  const scored = input.phrases.flatMap((phrase) =>
    topicNodes.map((node) => ({
      ...scoreTopicMatch(phrase.phrase, node),
      phrase,
    })),
  );
  const selected = [...scored].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "ja-JP"))[0] ?? null;
  if (selected && selected.score >= TOPIC_MATCH_THRESHOLD) {
    return {
      selectedTopicId: selected.topicId,
      selectedScores: scored
        .filter((item) => item.phrase.phrase === selected.phrase.phrase)
        .map(({ phrase: _phrase, ...rest }) => rest)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5),
      shouldCreateTopic: false,
      selectedPhrase: selected.phrase,
    };
  }

  return {
    selectedTopicId: null,
    selectedScores: input.phrases[0]
      ? topicNodes
          .map((node) => scoreTopicMatch(input.phrases[0].phrase, node))
          .sort((left, right) => right.score - left.score)
          .slice(0, 5)
      : [],
    shouldCreateTopic: Boolean(input.phrases[0]),
    selectedPhrase: input.phrases[0] ?? null,
  };
}

function projectState(graph: MeetingGraph, currentTopicId: string | null, segments: AnalyzedSegment[]): Pick<TopicEngineState, "nodes" | "edges"> {
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
  });
}

export function createInitialTopicEngineState(now = Date.now()): TopicEngineState {
  const meetingGraph = createInitialMeetingGraph("attension_mindmap v0.1");
  const projection = projectGraphToFlow({
    graph: meetingGraph,
    currentTopicId: null,
    evidenceByTopicId: new Map(),
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
  const projection = projectState(state.meetingGraph, nextCurrentTopicId, state.segments);

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

  nextGraph = closeDormantTopics(nextGraph, nextCurrentTopicId, now, segmentIndex);
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
  const projection = projectState(nextGraph, nextCurrentTopicId, nextSegments);

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
  };
}

export function getCurrentTopicGaps(state: TopicEngineState): TopicGap[] {
  if (!state.currentTopicId) return [];
  return state.meetingGraph.gaps.filter((gap) => gap.topicId === state.currentTopicId && !gap.closedAt);
}
