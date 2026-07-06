import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createTopicEngineStore } from "./topicEngineStore";

const SEGMENT_INTERVAL_MS = 5000;

type UseTopicEngineOptions = {
  onLog?: (entry: import("../types/topic").SessionLogEntry) => void;
};

export function useTopicEngine({ onLog }: UseTopicEngineOptions = {}) {
  const storeRef = useRef<ReturnType<typeof createTopicEngineStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTopicEngineStore({ onLog });
  }

  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    store.setOnLog(onLog);
  }, [onLog, store]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      store.flushBuffer();
    }, SEGMENT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [store]);

  const currentTopic = useMemo(
    () => snapshot.engineState.meetingGraph.nodes.find((node) => node.id === snapshot.engineState.currentTopicId) ?? null,
    [snapshot.engineState.currentTopicId, snapshot.engineState.meetingGraph.nodes],
  );

  const currentTopicGaps = useMemo(() => store.getCurrentTopicGaps(), [snapshot.engineState, store]);

  return {
    addLog: store.addLog,
    addTranscriptText: store.addTranscriptText,
    bufferText: snapshot.bufferText,
    currentTopic,
    currentTopicGaps,
    currentTopicId: snapshot.engineState.currentTopicId,
    decisionLogs: snapshot.engineState.decisionLogs,
    edges: snapshot.engineState.edges,
    focusState: snapshot.engineState.focusState,
    flushBuffer: store.flushBuffer,
    importantMentions: snapshot.engineState.importantMentions,
    logs: snapshot.logs,
    meetingGraph: snapshot.engineState.meetingGraph,
    meetingStartedAt: snapshot.engineState.meetingStartedAt,
    nodes: snapshot.engineState.nodes,
    reset: store.reset,
    segments: snapshot.engineState.segments,
    setFocusLocked: store.setFocusLocked,
    setManualFocus: store.setManualFocus,
    submitTimedTranscript: store.submitTimedTranscript,
    submitTranscript: store.submitTranscript,
  };
}
