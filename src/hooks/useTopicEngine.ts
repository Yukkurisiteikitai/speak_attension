import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyzedSegment,
  ConversationContext,
  FocusState,
  ImportantMention,
  ResolvedReference,
  SessionLogEntry,
  TopicDecisionLog,
  TopicGraphEdge,
  TopicGraphNode,
  TranscriptInputSource,
  TranscriptSegment,
} from "../types/topic";
import {
  INITIAL_TOPIC_EDGES,
  INITIAL_TOPIC_NODES,
  buildUnknownTopicLabel,
  createId,
  scoreTopicBreakdown,
  sortTopicScores,
} from "../utils/topicRules";
import { resolveReferences } from "../utils/contextResolver";
import { evaluateFocusGate } from "../utils/focusGate";
import { detectUtteranceIntent } from "../utils/intentRules";

const HEAT_INCREMENT = 0.25;
const ADJACENT_HEAT_INCREMENT = 0.1;
const HEAT_DECAY = 0.01;
const SEGMENT_INTERVAL_MS = 5000;
const UNKNOWN_MIN_LENGTH = 20;
const UNKNOWN_DUPLICATE_WINDOW_MS = 60_000;
const REFERENCE_CONFIDENCE_THRESHOLD = 0.6;

type UseTopicEngineOptions = {
  onLog?: (entry: SessionLogEntry) => void;
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

function getTopicLabel(nodes: TopicGraphNode[], topicId: string | null): string | null {
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

export function useTopicEngine({ onLog }: UseTopicEngineOptions = {}) {
  const [nodes, setNodes] = useState<TopicGraphNode[]>(() => cloneInitialNodes());
  const [edges, setEdges] = useState<TopicGraphEdge[]>(() => cloneInitialEdges());
  const [segments, setSegments] = useState<AnalyzedSegment[]>([]);
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);
  const [focusState, setFocusState] = useState<FocusState>(() => ({
    focusTopicId: null,
    focusLabel: null,
    focusSetBy: "auto",
    locked: false,
    startedAt: Date.now(),
  }));
  const [bufferText, setBufferText] = useState("");
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [decisionLogs, setDecisionLogs] = useState<TopicDecisionLog[]>([]);
  const [importantMentions, setImportantMentions] = useState<ImportantMention[]>([]);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const bufferRef = useRef("");
  const segmentsRef = useRef(segments);
  const currentTopicIdRef = useRef<string | null>(currentTopicId);
  const focusStateRef = useRef(focusState);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    currentTopicIdRef.current = currentTopicId;
  }, [currentTopicId]);

  useEffect(() => {
    focusStateRef.current = focusState;
  }, [focusState]);

  const addLog = useCallback(
    (entry: Omit<SessionLogEntry, "id" | "at"> & { at?: number }) => {
      const nextEntry: SessionLogEntry = {
        id: createId("log"),
        at: entry.at ?? Date.now(),
        type: entry.type,
        message: entry.message,
        payload: entry.payload,
      };
      setLogs((current) => [nextEntry, ...current].slice(0, 80));
      onLog?.(nextEntry);
    },
    [onLog],
  );

  const processSegment = useCallback(
    (text: string, source: TranscriptInputSource) => {
      const now = Date.now();
      const baseNodes = nodesRef.current;
      const currentFocusState = focusStateRef.current;
      const intent = detectUtteranceIntent(text);
      const context: ConversationContext = {
        activeTopicId: currentTopicIdRef.current,
        recentTopicIds: segmentsRef.current.flatMap((segment) => segment.matchedTopicIds).slice(0, 8),
        recentSegments: segmentsRef.current.slice(0, 8),
      };
      const references = resolveReferences(text, context);
      const unresolvedReferences = references
        .filter((reference) => reference.confidence < REFERENCE_CONFIDENCE_THRESHOLD || !reference.candidateTopicId)
        .map((reference) => reference.phrase);
      const confidentReferences = references.filter(
        (reference) => reference.confidence >= REFERENCE_CONFIDENCE_THRESHOLD && reference.candidateTopicId,
      );
      const topicScores = sortTopicScores(
        baseNodes.map((node, index) => ({
          ...scoreTopicBreakdown({
            text,
            node,
            focusState: currentFocusState,
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
      const selectedTopicLabel = getTopicLabel(baseNodes, selectedTopicId);
      const focusGate = evaluateFocusGate({
        text,
        focusState: currentFocusState,
        intent,
        selectedTopicId,
        matchedTopicIds,
        topicScores,
        resolvedReferences: confidentReferences,
        unresolvedReferences,
        edges: edgesRef.current,
        nodes: baseNodes,
      });
      let activeTopicId = focusGate.shouldUpdateCurrentTopic ? selectedTopicId ?? currentFocusState.focusTopicId : currentTopicIdRef.current;
      let nextNodes = baseNodes;
      let nextEdges = edgesRef.current;
      let nextFocusState = currentFocusState;
      let createdNodeId: string | null = null;

      if (focusGate.shouldChangeFocus && focusGate.focusChangeCandidateTopicId) {
        const nextFocusTopicId = focusGate.focusChangeCandidateTopicId;
        nextFocusState = {
          ...nextFocusState,
          focusTopicId: nextFocusTopicId,
          focusLabel: getTopicLabel(baseNodes, nextFocusTopicId),
          focusSetBy: "auto",
          startedAt: now,
        };
        activeTopicId = nextFocusTopicId;
      }

      if (focusGate.focusRelation === "on_focus") {
        const topicIdsToTouch = selectedTopicId ? matchedTopicIds : [nextFocusState.focusTopicId].filter(Boolean);
        nextNodes = touchNodes(baseNodes, topicIdsToTouch as string[], text, now, HEAT_INCREMENT);
        activeTopicId = selectedTopicId ?? nextFocusState.focusTopicId;
      } else if (focusGate.focusRelation === "adjacent") {
        nextNodes = touchNodes(baseNodes, matchedTopicIds, text, now, ADJACENT_HEAT_INCREMENT);
      }

      const canCreateUnknownNode =
        matchedTopicIds.length === 0 &&
        text.length >= UNKNOWN_MIN_LENGTH &&
        focusGate.focusRelation !== "off_topic_noise" &&
        focusGate.focusRelation !== "off_topic_important" &&
        unresolvedReferences.length === 0;

      if (canCreateUnknownNode) {
        const duplicate = findUnknownDuplicate(baseNodes, text, now);
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
            position: nextCustomPosition(baseNodes),
            data: {
              label,
              heat: HEAT_INCREMENT,
              keywords: [label, label.slice(0, 8)].filter(Boolean),
              normalizedTerms: [],
              lastTouchedAt: now,
              evidence: [text],
            },
          };
          nextNodes = [...baseNodes, customNode];
          nextEdges = [
            ...edgesRef.current,
            {
              id: `topic-${id}`,
              source: nextFocusState.focusTopicId ?? currentTopicIdRef.current ?? "topic-detection",
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

      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      currentTopicIdRef.current = activeTopicId;
      focusStateRef.current = nextFocusState;
      segmentsRef.current = [segment, ...segmentsRef.current].slice(0, 60);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setCurrentTopicId(activeTopicId);
      setFocusState(nextFocusState);
      setSegments(segmentsRef.current);
      setDecisionLogs((current) => [decisionLog, ...current].slice(0, 60));
      if (importantMention) setImportantMentions((current) => [importantMention, ...current].slice(0, 40));
      addLog({
        type: "decision",
        message: `segment analyzed as ${focusGate.focusRelation}`,
        payload: {
          segment,
          decisionLog,
          importantMention,
        },
        at: now,
      });
    },
    [addLog],
  );

  const flushBuffer = useCallback(() => {
    const text = bufferRef.current.replace(/\s+/g, " ").trim();
    if (!text) return;
    bufferRef.current = "";
    setBufferText("");
    processSegment(text, "speech");
  }, [processSegment]);

  const addTranscriptText = useCallback(
    (text: string) => {
      const cleanText = text.replace(/\s+/g, " ").trim();
      if (!cleanText) return;
      bufferRef.current = [bufferRef.current, cleanText].filter(Boolean).join(" ");
      setBufferText(bufferRef.current);
      addLog({
        type: "speech",
        message: "speech chunk received",
        payload: { text: cleanText, source: "speech" },
      });
    },
    [addLog],
  );

  const submitTranscript = useCallback(
    (text: string, source: Exclude<TranscriptInputSource, "speech">) => {
      const cleanText = text.replace(/\s+/g, " ").trim();
      if (!cleanText) return;
      processSegment(cleanText, source);
    },
    [processSegment],
  );

  const reset = useCallback(() => {
    const initialNodes = cloneInitialNodes();
    const initialEdges = cloneInitialEdges();
    nodesRef.current = initialNodes;
    edgesRef.current = initialEdges;
    bufferRef.current = "";
    segmentsRef.current = [];
    currentTopicIdRef.current = null;
    focusStateRef.current = {
      focusTopicId: null,
      focusLabel: null,
      focusSetBy: "auto",
      locked: false,
      startedAt: Date.now(),
    };
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSegments([]);
    setCurrentTopicId(null);
    setFocusState(focusStateRef.current);
    setBufferText("");
    setLogs([]);
    setDecisionLogs([]);
    setImportantMentions([]);
  }, []);

  const setManualFocus = useCallback(
    (topicId: string | null) => {
      const now = Date.now();
      const nextFocusState: FocusState = {
        ...focusStateRef.current,
        focusTopicId: topicId,
        focusLabel: getTopicLabel(nodesRef.current, topicId),
        focusSetBy: "manual",
        startedAt: now,
      };
      focusStateRef.current = nextFocusState;
      currentTopicIdRef.current = topicId;
      setFocusState(nextFocusState);
      setCurrentTopicId(topicId);
      addLog({
        type: "system",
        message: topicId ? "manual focus selected" : "manual focus cleared",
        payload: { focusState: nextFocusState },
        at: now,
      });
    },
    [addLog],
  );

  const setFocusLocked = useCallback(
    (locked: boolean) => {
      const now = Date.now();
      const nextFocusState: FocusState = {
        ...focusStateRef.current,
        locked,
      };
      focusStateRef.current = nextFocusState;
      setFocusState(nextFocusState);
      addLog({
        type: "system",
        message: locked ? "focus locked" : "focus unlocked",
        payload: { focusState: nextFocusState },
        at: now,
      });
    },
    [addLog],
  );

  useEffect(() => {
    const timer = window.setInterval(flushBuffer, SEGMENT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flushBuffer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNodes((current) => {
        const next = current.map((node) => ({
          ...node,
          data: {
            ...node.data,
            heat: Math.max(0, Number((node.data.heat - HEAT_DECAY).toFixed(2))),
          },
        }));
        nodesRef.current = next;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentTopic = useMemo(
    () => nodes.find((node) => node.id === currentTopicId) ?? null,
    [currentTopicId, nodes],
  );

  const heatLeaders = useMemo(
    () => [...nodes].sort((a, b) => b.data.heat - a.data.heat).slice(0, 6),
    [nodes],
  );

  return {
    addLog,
    addTranscriptText,
    bufferText,
    currentTopic,
    currentTopicId,
    decisionLogs,
    edges,
    focusState,
    flushBuffer,
    heatLeaders,
    importantMentions,
    logs,
    nodes,
    reset,
    segments,
    setFocusLocked,
    setManualFocus,
    submitTranscript,
  };
}
