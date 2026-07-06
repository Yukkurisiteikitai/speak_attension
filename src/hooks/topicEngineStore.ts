import { createId } from "../utils/topicProjection";
import {
  createInitialTopicEngineState,
  getCurrentTopicGaps,
  processTopicSegment,
  setFocusLockedState,
  setManualFocusState,
  type TopicEngineState,
  type TopicEngineTransition,
} from "../utils/topicEngine";
import type { SessionLogEntry, TimedTranscriptSegment, TranscriptSegmentMetadata, TranscriptInputSource } from "../types/topic";

type TopicEngineStoreSnapshot = {
  engineState: TopicEngineState;
  bufferText: string;
  logs: SessionLogEntry[];
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
  reset: () => void;
  setFocusLocked: (locked: boolean) => void;
  setManualFocus: (topicId: string | null) => void;
  setOnLog: (onLog?: (entry: SessionLogEntry) => void) => void;
  submitTimedTranscript: (segment: TimedTranscriptSegment) => void;
  submitTranscript: (text: string, source: Exclude<TranscriptInputSource, "speech">) => void;
  subscribe: (listener: () => void) => () => void;
};

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
    bufferText: "",
    logs: [],
  };
  const listeners = new Set<() => void>();

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
    });
  }

  function processSegment(text: string, source: TranscriptInputSource, metadata?: TranscriptSegmentMetadata) {
    const now = Date.now();
    const transition = attachSegmentMetadata(processTopicSegment(snapshot.engineState, text, source, now), metadata);
    applyTransition(transition, now);
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
    reset() {
      writeSnapshot({
        engineState: createInitialTopicEngineState(),
        bufferText: "",
        logs: [],
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
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type { TopicEngineStore, TopicEngineStoreSnapshot };
