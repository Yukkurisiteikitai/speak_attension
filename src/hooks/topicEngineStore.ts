import { createId } from "../utils/topicProjection";
import {
  appendConversationSegment,
  createInitialConversationTreeState,
  toggleConversationNodeRating,
  updateConversationNode,
} from "../utils/conversationTree";
import {
  applyTopicTitleRefinements,
  createInitialTopicEngineState,
  getCurrentTopicGaps,
  processTopicSegment,
  setFocusLockedState,
  setManualFocusState,
  type TopicEngineState,
  type TopicEngineTransition,
} from "../utils/topicEngine";
import { refineTopicTitlesWithLlm, type TopicTitleCandidate } from "../utils/llmTopicTitle";
import { refineMeetingSummaryWithLlm } from "../utils/llmMeetingSynthesis";
import { type LlmSettings } from "../utils/llmClient";
import { buildRuleBasedMeetingSummary, renameMeetingSummaryNode } from "../utils/meetingSynthesis";
import type { AnalyzedSegment, ConversationNodeRole, ConversationTreeState, MeetingSummary, MeetingSummaryStatus, SessionLogEntry, TimedTranscriptSegment, TranscriptSegmentMetadata, TranscriptInputSource } from "../types/topic";

type TopicEngineStoreSnapshot = {
  engineState: TopicEngineState;
  conversationTree: ConversationTreeState;
  bufferText: string;
  logs: SessionLogEntry[];
  segmentArchive: AnalyzedSegment[];
  meetingSummary: MeetingSummary | null;
  meetingSummaryStatus: MeetingSummaryStatus;
  meetingSummaryError: string | null;
  meetingSummaryStale: boolean;
  meetingSummaryStartedAt: number | null;
};

type TopicEngineStoreOptions = {
  onLog?: (entry: SessionLogEntry) => void;
};

type TopicEngineStore = {
  addLog: (entry: Omit<SessionLogEntry, "id" | "at"> & { at?: number }) => void;
  addTranscriptText: (text: string) => void;
  flushBuffer: () => void;
  getCurrentTopicGaps: () => ReturnType<typeof getCurrentTopicGaps>;
  getSnapshot: () => TopicEngineStoreSnapshot;
  organizeMeeting: () => Promise<void>;
  renameMeetingSummaryNode: (nodeId: string, title: string) => void;
  reset: () => void;
  setFocusLocked: (locked: boolean) => void;
  setLlmSettings: (settings: LlmSettings | null) => void;
  setManualFocus: (topicId: string | null) => void;
  setOnLog: (onLog?: (entry: SessionLogEntry) => void) => void;
  submitTimedTranscript: (segment: TimedTranscriptSegment) => void;
  submitTranscript: (text: string, source: Exclude<TranscriptInputSource, "speech">) => void;
  toggleConversationNodeRating: (nodeId: string) => void;
  updateConversationNode: (nodeId: string, patch: { role?: ConversationNodeRole; parentId?: string | null }) => void;
  subscribe: (listener: () => void) => () => void;
};

// Owns the live engine snapshot and the command queue for speech, manual text, and replay input.
function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function attachSegmentMetadata(
  transition: TopicEngineTransition,
  metadata?: TranscriptSegmentMetadata,
): TopicEngineTransition {
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
}

export function createTopicEngineStore(options: TopicEngineStoreOptions = {}): TopicEngineStore {
  let onLog = options.onLog;
  let snapshot: TopicEngineStoreSnapshot = {
    engineState: createInitialTopicEngineState(),
    conversationTree: createInitialConversationTreeState(),
    bufferText: "",
    logs: [],
    segmentArchive: [],
    meetingSummary: null,
    meetingSummaryStatus: "idle",
    meetingSummaryError: null,
    meetingSummaryStale: false,
    meetingSummaryStartedAt: null,
  };
  const listeners = new Set<() => void>();
  let currentLlmSettings: LlmSettings | null = null;
  let titleRefineQueue: string[] = [];
  let isRefiningTitle = false;
  let sessionEpoch = 0;
  let summaryEpoch = 0;

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function writeSnapshot(nextSnapshot: TopicEngineStoreSnapshot) {
    snapshot = nextSnapshot;
    emit();
  }

  function addLog(entry: Omit<SessionLogEntry, "id" | "at"> & { at?: number }) {
    const nextEntry: SessionLogEntry = {
      id: createId("log"),
      at: entry.at ?? Date.now(),
      type: entry.type,
      message: entry.message,
      payload: entry.payload,
    };
    snapshot = {
      ...snapshot,
      logs: [nextEntry, ...snapshot.logs].slice(0, 120),
    };
    onLog?.(nextEntry);
  }

  function applyTransition(transition: TopicEngineTransition, now: number) {
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
    writeSnapshot({
      ...snapshot,
      engineState: transition.state,
      conversationTree: appendConversationSegment(snapshot.conversationTree, transition.segment),
      // Engine state trims segments to the latest 80 for UI perf; keep the full
      // meeting here so the post-meeting report can quote every evidence segment.
      segmentArchive: [...snapshot.segmentArchive, transition.segment],
      meetingSummaryStale: snapshot.meetingSummary ? true : snapshot.meetingSummaryStale,
    });

    if (transition.newlyClosedTopicIds.length > 0) {
      titleRefineQueue.push(...transition.newlyClosedTopicIds);
      titleRefineQueue = [...new Set(titleRefineQueue)];
      void processTitleRefineQueue();
    }
  }

  function processSegment(text: string, source: TranscriptInputSource, metadata?: TranscriptSegmentMetadata) {
    const now = Date.now();
    const transition = attachSegmentMetadata(processTopicSegment(snapshot.engineState, text, source, now), metadata);
    applyTransition(transition, now);
  }

  async function processTitleRefineQueue() {
    if (isRefiningTitle) return;
    isRefiningTitle = true;
    const epoch = sessionEpoch;

    try {
      while (titleRefineQueue.length > 0) {
        const topicId = titleRefineQueue.shift()!;
        if (epoch !== sessionEpoch) break;
        if (!currentLlmSettings?.model) continue;

        const node = snapshot.engineState.meetingGraph.nodes.find((n) => n.id === topicId);
        if (!node) continue;

        const segmentById = new Map(snapshot.segmentArchive.map((s) => [s.id, s.text]));
        const candidate: TopicTitleCandidate = {
          topicId: node.id,
          currentTitle: node.title,
          evidenceQuotes: node.evidenceSegmentIds.slice(0, 4).map((id) => segmentById.get(id)).filter((t): t is string => Boolean(t)),
        };

        try {
          const refinements = await refineTopicTitlesWithLlm(currentLlmSettings, [candidate]);
          if (epoch !== sessionEpoch) break;

          const updates = new Map(refinements.map((r) => [r.topicId, r.title]));
          const nextEngineState = applyTopicTitleRefinements(snapshot.engineState, updates, Date.now());
          writeSnapshot({ ...snapshot, engineState: nextEngineState });
          addLog({
            type: "system",
            message: `トピック「${node.title}」のタイトルをLLMで整理しました`,
            payload: { topicId, from: node.title, to: updates.get(topicId) },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addLog({
            type: "system",
            message: `タイトル整理に失敗したため「${node.title}」のままにします: ${message}`,
            payload: { topicId, error: message },
          });
        }
      }
    } finally {
      isRefiningTitle = false;
    }
  }

  return {
    addLog,
    addTranscriptText(text) {
      const nextText = cleanText(text);
      if (!nextText) return;
      const bufferText = [snapshot.bufferText, nextText].filter(Boolean).join(" ");
      addLog({
        type: "speech",
        message: "speech chunk received",
        payload: { text: nextText, source: "speech" },
      });
      writeSnapshot({
        ...snapshot,
        bufferText,
      });
    },
    flushBuffer() {
      const text = cleanText(snapshot.bufferText);
      if (!text) return;
      snapshot = {
        ...snapshot,
        bufferText: "",
      };
      processSegment(text, "speech");
    },
    getCurrentTopicGaps() {
      return getCurrentTopicGaps(snapshot.engineState);
    },
    getSnapshot() {
      return snapshot;
    },
    async organizeMeeting() {
      if (snapshot.segmentArchive.length === 0) return;
      const fallback = buildRuleBasedMeetingSummary({
        meetingGraph: snapshot.engineState.meetingGraph,
        segments: snapshot.segmentArchive,
      });
      const requestEpoch = ++summaryEpoch;
      const requestSessionEpoch = sessionEpoch;
      const startedAt = Date.now();
      const canUseLlm = Boolean(currentLlmSettings?.model);
      writeSnapshot({
        ...snapshot,
        meetingSummary: fallback,
        meetingSummaryStatus: canUseLlm ? "refining" : "rules",
        meetingSummaryError: null,
        meetingSummaryStale: false,
        meetingSummaryStartedAt: startedAt,
      });
      if (!canUseLlm || !currentLlmSettings) return;

      try {
        const refined = await refineMeetingSummaryWithLlm(snapshot.segmentArchive, fallback, currentLlmSettings);
        if (requestEpoch !== summaryEpoch || requestSessionEpoch !== sessionEpoch) return;
        writeSnapshot({
          ...snapshot,
          meetingSummary: refined,
          meetingSummaryStatus: "llm",
          meetingSummaryError: null,
          meetingSummaryStale: false,
          meetingSummaryStartedAt: startedAt,
        });
      } catch (error) {
        if (requestEpoch !== summaryEpoch || requestSessionEpoch !== sessionEpoch) return;
        writeSnapshot({
          ...snapshot,
          meetingSummary: fallback,
          meetingSummaryStatus: "error",
          meetingSummaryError: error instanceof Error ? error.message : String(error),
          meetingSummaryStale: false,
          meetingSummaryStartedAt: startedAt,
        });
      }
    },
    renameMeetingSummaryNode(nodeId, title) {
      if (!snapshot.meetingSummary) return;
      writeSnapshot({
        ...snapshot,
        meetingSummary: renameMeetingSummaryNode(snapshot.meetingSummary, nodeId, title),
      });
    },
    reset() {
      titleRefineQueue = [];
      sessionEpoch += 1;
      summaryEpoch += 1;
      writeSnapshot({
        engineState: createInitialTopicEngineState(),
        conversationTree: createInitialConversationTreeState(),
        bufferText: "",
        logs: [],
        segmentArchive: [],
        meetingSummary: null,
        meetingSummaryStatus: "idle",
        meetingSummaryError: null,
        meetingSummaryStale: false,
        meetingSummaryStartedAt: null,
      });
    },
    setFocusLocked(locked) {
      const now = Date.now();
      const nextState = setFocusLockedState(snapshot.engineState, locked);
      addLog({
        type: "system",
        message: locked ? "focus locked" : "focus unlocked",
        payload: { focusState: nextState.focusState },
        at: now,
      });
      writeSnapshot({
        ...snapshot,
        engineState: nextState,
      });
    },
    setLlmSettings(settings) {
      currentLlmSettings = settings;
    },
    setManualFocus(topicId) {
      const now = Date.now();
      const nextState = setManualFocusState(snapshot.engineState, topicId, now);
      addLog({
        type: "system",
        message: topicId ? "manual focus selected" : "manual focus cleared",
        payload: { focusState: nextState.focusState },
        at: now,
      });
      writeSnapshot({
        ...snapshot,
        engineState: nextState,
      });
    },
    setOnLog(nextOnLog) {
      onLog = nextOnLog;
    },
    submitTimedTranscript(segment) {
      const nextText = cleanText(segment.text);
      if (!nextText) return;
      processSegment(nextText, "replay", {
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        transcriptSource: segment.source,
        confidence: segment.confidence,
        words: segment.words,
        raw: segment.raw,
      });
    },
    submitTranscript(text, source) {
      const nextText = cleanText(text);
      if (!nextText) return;
      processSegment(nextText, source);
    },
    toggleConversationNodeRating(nodeId) {
      const nextTree = toggleConversationNodeRating(snapshot.conversationTree, nodeId);
      if (nextTree === snapshot.conversationTree) return;
      writeSnapshot({ ...snapshot, conversationTree: nextTree });
    },
    updateConversationNode(nodeId, patch) {
      const nextTree = updateConversationNode(snapshot.conversationTree, nodeId, patch);
      if (nextTree === snapshot.conversationTree) return;
      writeSnapshot({ ...snapshot, conversationTree: nextTree });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type { TopicEngineStore, TopicEngineStoreSnapshot };
