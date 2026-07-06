import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionLogEntry, TimedTranscriptSegment, TranscriptSegmentMetadata, TranscriptInputSource } from "../types/topic";
import { createId } from "../utils/topicRules";
import {
  createInitialTopicEngineState,
  getCurrentTopicGaps,
  processTopicSegment,
  setFocusLockedState,
  setManualFocusState,
  type TopicEngineState,
} from "../utils/topicEngine";

const SEGMENT_INTERVAL_MS = 5000;

type UseTopicEngineOptions = {
  onLog?: (entry: SessionLogEntry) => void;
};

export function useTopicEngine({ onLog }: UseTopicEngineOptions = {}) {
  const [engineState, setEngineState] = useState<TopicEngineState>(() => createInitialTopicEngineState());
  const [bufferText, setBufferText] = useState("");
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const stateRef = useRef(engineState);
  const bufferRef = useRef("");

  useEffect(() => {
    stateRef.current = engineState;
  }, [engineState]);

  const attachSegmentMetadata = useCallback(
    (
      transition: ReturnType<typeof processTopicSegment>,
      metadata?: TranscriptSegmentMetadata,
    ): ReturnType<typeof processTopicSegment> => {
      if (!metadata) return transition;

      const segmentWithMetadata = {
        ...transition.segment,
        metadata,
      };
      const nextSegments = transition.state.segments.map((segment, index) => (index === 0 ? segmentWithMetadata : segment));

      return {
        ...transition,
        segment: segmentWithMetadata,
        state: {
          ...transition.state,
          segments: nextSegments,
        },
      };
    },
    [],
  );

  const addLog = useCallback(
    (entry: Omit<SessionLogEntry, "id" | "at"> & { at?: number }) => {
      const nextEntry: SessionLogEntry = {
        id: createId("log"),
        at: entry.at ?? Date.now(),
        type: entry.type,
        message: entry.message,
        payload: entry.payload,
      };
      setLogs((current) => [nextEntry, ...current].slice(0, 120));
      onLog?.(nextEntry);
    },
    [onLog],
  );

  const processSegment = useCallback(
    (text: string, source: TranscriptInputSource, metadata?: TranscriptSegmentMetadata) => {
      const now = Date.now();
      const transition = attachSegmentMetadata(processTopicSegment(stateRef.current, text, source, now), metadata);
      stateRef.current = transition.state;
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
    [addLog, attachSegmentMetadata],
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

  const submitTimedTranscript = useCallback(
    (segment: TimedTranscriptSegment) => {
      const cleanText = segment.text.replace(/\s+/g, " ").trim();
      if (!cleanText) return;
      processSegment(cleanText, "replay", {
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        transcriptSource: segment.source,
        confidence: segment.confidence,
        words: segment.words,
        raw: segment.raw,
      });
    },
    [processSegment],
  );

  const reset = useCallback(() => {
    const initialState = createInitialTopicEngineState();
    stateRef.current = initialState;
    bufferRef.current = "";
    setEngineState(initialState);
    setBufferText("");
    setLogs([]);
  }, []);

  const setManualFocus = useCallback(
    (topicId: string | null) => {
      const now = Date.now();
      const nextState = setManualFocusState(stateRef.current, topicId, now);
      stateRef.current = nextState;
      setEngineState(nextState);
      addLog({
        type: "system",
        message: topicId ? "manual focus selected" : "manual focus cleared",
        payload: { focusState: nextState.focusState },
        at: now,
      });
    },
    [addLog],
  );

  const setFocusLocked = useCallback(
    (locked: boolean) => {
      const now = Date.now();
      const nextState = setFocusLockedState(stateRef.current, locked);
      stateRef.current = nextState;
      setEngineState(nextState);
      addLog({
        type: "system",
        message: locked ? "focus locked" : "focus unlocked",
        payload: { focusState: nextState.focusState },
        at: now,
      });
    },
    [addLog],
  );

  useEffect(() => {
    const timer = window.setInterval(flushBuffer, SEGMENT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flushBuffer]);

  const currentTopic = useMemo(
    () => engineState.meetingGraph.nodes.find((node) => node.id === engineState.currentTopicId) ?? null,
    [engineState.currentTopicId, engineState.meetingGraph.nodes],
  );

  const currentTopicGaps = useMemo(() => getCurrentTopicGaps(engineState), [engineState]);

  return {
    addLog,
    addTranscriptText,
    bufferText,
    currentTopic,
    currentTopicGaps,
    currentTopicId: engineState.currentTopicId,
    decisionLogs: engineState.decisionLogs,
    edges: engineState.edges,
    focusState: engineState.focusState,
    flushBuffer,
    importantMentions: engineState.importantMentions,
    logs,
    meetingGraph: engineState.meetingGraph,
    meetingStartedAt: engineState.meetingStartedAt,
    nodes: engineState.nodes,
    reset,
    segments: engineState.segments,
    setFocusLocked,
    setManualFocus,
    submitTimedTranscript,
    submitTranscript,
  };
}
