import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyzedSegment,
  FocusState,
  ImportantMention,
  SessionLogEntry,
  TopicDecisionLog,
  TopicGraphEdge,
  TopicGraphNode,
  TranscriptInputSource,
} from "../types/topic";
import { createId } from "../utils/topicRules";
import {
  createInitialTopicEngineState,
  processTopicSegment,
  setFocusLockedState,
  setManualFocusState,
  type TopicEngineState,
} from "../utils/topicEngine";

const HEAT_DECAY = 0.01;
const SEGMENT_INTERVAL_MS = 5000;

type UseTopicEngineOptions = {
  onLog?: (entry: SessionLogEntry) => void;
};

export function useTopicEngine({ onLog }: UseTopicEngineOptions = {}) {
  const [engineState, setEngineState] = useState<TopicEngineState>(() => createInitialTopicEngineState());
  const [bufferText, setBufferText] = useState("");
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const { nodes, edges, segments, currentTopicId, focusState, decisionLogs, importantMentions } = engineState;

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const bufferRef = useRef("");
  const segmentsRef = useRef(segments);
  const currentTopicIdRef = useRef<string | null>(currentTopicId);
  const focusStateRef = useRef(focusState);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    segmentsRef.current = segments;
    currentTopicIdRef.current = currentTopicId;
    focusStateRef.current = focusState;
  }, [currentTopicId, edges, focusState, nodes, segments]);

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
      const transition = processTopicSegment(
        {
          nodes: nodesRef.current,
          edges: edgesRef.current,
          segments: segmentsRef.current,
          currentTopicId: currentTopicIdRef.current,
          focusState: focusStateRef.current,
          decisionLogs,
          importantMentions,
        },
        text,
        source,
        now,
      );

      nodesRef.current = transition.state.nodes;
      edgesRef.current = transition.state.edges;
      currentTopicIdRef.current = transition.state.currentTopicId;
      focusStateRef.current = transition.state.focusState;
      segmentsRef.current = transition.state.segments;
      setEngineState(transition.state);
      addLog({
        type: "decision",
        message: `segment analyzed as ${transition.segment.analysis.focusRelation}`,
        payload: {
          segment: transition.segment,
          decisionLog: transition.decisionLog,
          importantMention: transition.importantMention,
        },
        at: now,
      });
    },
    [addLog, decisionLogs, importantMentions],
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
    const initialState = createInitialTopicEngineState();
    nodesRef.current = initialState.nodes;
    edgesRef.current = initialState.edges;
    bufferRef.current = "";
    segmentsRef.current = initialState.segments;
    currentTopicIdRef.current = initialState.currentTopicId;
    focusStateRef.current = initialState.focusState;
    setEngineState(initialState);
    setBufferText("");
    setLogs([]);
  }, []);

  const setManualFocus = useCallback(
    (topicId: string | null) => {
      const now = Date.now();
      const nextState = setManualFocusState(
        {
          nodes: nodesRef.current,
          edges: edgesRef.current,
          segments: segmentsRef.current,
          currentTopicId: currentTopicIdRef.current,
          focusState: focusStateRef.current,
          decisionLogs,
          importantMentions,
        },
        topicId,
        now,
      );
      focusStateRef.current = nextState.focusState;
      currentTopicIdRef.current = nextState.currentTopicId;
      setEngineState(nextState);
      addLog({
        type: "system",
        message: topicId ? "manual focus selected" : "manual focus cleared",
        payload: { focusState: nextState.focusState },
        at: now,
      });
    },
    [addLog, decisionLogs, importantMentions],
  );

  const setFocusLocked = useCallback(
    (locked: boolean) => {
      const now = Date.now();
      const nextState = setFocusLockedState(
        {
          nodes: nodesRef.current,
          edges: edgesRef.current,
          segments: segmentsRef.current,
          currentTopicId: currentTopicIdRef.current,
          focusState: focusStateRef.current,
          decisionLogs,
          importantMentions,
        },
        locked,
      );
      focusStateRef.current = nextState.focusState;
      setEngineState(nextState);
      addLog({
        type: "system",
        message: locked ? "focus locked" : "focus unlocked",
        payload: { focusState: nextState.focusState },
        at: now,
      });
    },
    [addLog, decisionLogs, importantMentions],
  );

  useEffect(() => {
    const timer = window.setInterval(flushBuffer, SEGMENT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flushBuffer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEngineState((current) => {
        const nextNodes = current.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            heat: Math.max(0, Number((node.data.heat - HEAT_DECAY).toFixed(2))),
          },
        }));
        nodesRef.current = nextNodes;
        return {
          ...current,
          nodes: nextNodes,
        };
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
