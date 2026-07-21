import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createTopicEngineStore } from "./topicEngineStore";
import type { LlmSettings } from "../utils/llmClient";

const SEGMENT_INTERVAL_MS = 5000;

type UseTopicEngineOptions = {
  onLog?: (entry: import("../types/topic").SessionLogEntry) => void;
  llmSettings?: LlmSettings | null;
};

// React-facing adapter over the imperative topic engine store.
// This keeps UI code in sync with the latest snapshot without threading mutable refs through components.
export function useTopicEngine({ onLog, llmSettings }: UseTopicEngineOptions = {}) {
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
    store.setLlmSettings(llmSettings ?? null);
  }, [llmSettings, store]);

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
    conversationTree: snapshot.conversationTree,
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
    meetingSummary: snapshot.meetingSummary,
    meetingSummaryError: snapshot.meetingSummaryError,
    meetingSummaryStale: snapshot.meetingSummaryStale,
    meetingSummaryStartedAt: snapshot.meetingSummaryStartedAt,
    meetingSummaryStatus: snapshot.meetingSummaryStatus,
    nodes: snapshot.engineState.nodes,
    organizeMeeting: store.organizeMeeting,
    renameMeetingSummaryNode: store.renameMeetingSummaryNode,
    reset: store.reset,
    segmentArchive: snapshot.segmentArchive,
    segments: snapshot.engineState.segments,
    setFocusLocked: store.setFocusLocked,
    setManualFocus: store.setManualFocus,
    submitTimedTranscript: store.submitTimedTranscript,
    submitTranscript: store.submitTranscript,
    toggleConversationNodeRating: store.toggleConversationNodeRating,
    updateConversationNode: store.updateConversationNode,
  };
}
