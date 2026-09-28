import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createTopicEngineStore } from "./topicEngineStore";
import type { LlmSettings } from "../utils/llmClient";
import { buildMissingContributions } from "../utils/missingContribution";

// A final Web Speech chunk should reach the fast path within the realtime
// budget (ADR 0023 §10), not on a fixed 5s tick. The buffer is flushed once
// speech has been quiet for SPEECH_IDLE_FLUSH_MS -- a pause is the boundary
// signal -- with SPEECH_MAX_BUFFER_MS as a backstop for a speaker who never
// pauses. Polling at SEGMENT_POLL_MS only reads two timestamps.
const SEGMENT_POLL_MS = 250;
const SPEECH_IDLE_FLUSH_MS = 800;
const SPEECH_MAX_BUFFER_MS = 5000;

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
    const timer = window.setTimeout(() => { void store.reviewProgress(); }, 1200);
    const interval = window.setInterval(() => { void store.reviewProgress(); }, 3000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); store.cancelProgressReview(); };
  }, [llmSettings, store]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      store.flushIfIdle(SPEECH_IDLE_FLUSH_MS, SPEECH_MAX_BUFFER_MS);
    }, SEGMENT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store]);

  const currentTopic = useMemo(
    () => snapshot.engineState.meetingGraph.nodes.find((node) => node.id === snapshot.engineState.currentTopicId) ?? null,
    [snapshot.engineState.currentTopicId, snapshot.engineState.meetingGraph.nodes],
  );

  const currentTopicGaps = useMemo(() => store.getCurrentTopicGaps(), [snapshot.engineState, store]);

  const missingContributions = useMemo(() => buildMissingContributions({
    gaps: snapshot.engineState.meetingGraph.gaps,
    topics: snapshot.engineState.meetingGraph.nodes.filter((node) => node.id !== snapshot.engineState.meetingGraph.rootTopicId),
    decisionGraph: snapshot.engineState.decisionGraph,
    segments: snapshot.segmentArchive,
    currentTopicId: snapshot.engineState.currentTopicId,
  }), [snapshot.engineState.currentTopicId, snapshot.engineState.decisionGraph, snapshot.engineState.meetingGraph, snapshot.segmentArchive]);

  return {
    meetingReview: snapshot.meetingReview,
    setMeetingReview: store.setMeetingReview,
    armedDiscussionPrompt: snapshot.armedDiscussionPrompt,
    armDiscussionPrompt: store.armDiscussionPrompt,
    discussionPrompts: snapshot.discussionPrompts,
    progressReviewStatus: snapshot.progressReviewStatus,
    progressReviewError: snapshot.progressReviewError,
    answerDiscussionPrompt: store.answerDiscussionPrompt,
    setDiscussionPromptDeferred: store.setDiscussionPromptDeferred,
    updateAction: store.updateAction,
    addLog: store.addLog,
    addTranscriptText: store.addTranscriptText,
    bufferText: snapshot.bufferText,
    conversationTree: snapshot.conversationTree,
    currentTopic,
    currentTopicGaps,
    currentTopicId: snapshot.engineState.currentTopicId,
    decisionGraph: snapshot.engineState.decisionGraph,
    decisionLogs: snapshot.engineState.decisionLogs,
    decisionSupport: snapshot.decisionSupport,
    analyzeDecisionSupport: store.analyzeDecisionSupport,
    updateDecisionMaterialStatus: store.updateDecisionMaterialStatus,
    edges: snapshot.engineState.edges,
    focusState: snapshot.engineState.focusState,
    flushBuffer: store.flushBuffer,
    importantMentions: snapshot.engineState.importantMentions,
    logs: snapshot.logs,
    meetingGraph: snapshot.engineState.meetingGraph,
    missingContributions,
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
