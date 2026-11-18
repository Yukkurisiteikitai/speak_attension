import { initialMeetingReview, planMeetingReview, type MeetingReview } from "../utils/meetingReview";
import { updateMeetingAction, type ActionUpdate } from "../utils/meetingDecisionGraph";
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
import { requestChat } from "../utils/llmClient";
import { buildMissingContributions } from "../utils/missingContribution";
import { analyzeDecisionMaterials, updateDecisionMaterialStatus } from "../utils/decisionSupport";
import { buildDiscussionPrompts, recordDiscussionAnswer, type DiscussionPrompt } from "../utils/meetingProgress";
import { applyProgressReview, buildProgressReviewMessages } from "../utils/meetingProgressReview";
import { buildRuleBasedMeetingSummary, renameMeetingSummaryNode } from "../utils/meetingSynthesis";
import { appendUtterance, createEventLog, recentUtterances, type MeetingEventLog } from "../semantic/rawUtterance";
import { emptyFastPathContext, runFastPath, FAST_PATH_CONTEXT_WINDOW } from "../semantic/fastPath";
import { createCanonicalState, entriesOfKind, reduceCanonical } from "../semantic/canonicalReducer";
import { applyItemCorrection, applyReviewAction, synchronizeReview, type ReviewResult } from "../semantic/reviewEventReducer";
import type { ReviewAction, ReviewTarget } from "../semantic/meetingItem";
import { SEMANTIC_CORE_FLAGS } from "../semantic/flags";
import { MEETING_ARCHIVE_SCHEMA_VERSION, projectMeetingArchive, type MeetingArchive, type ArchiveProjection } from "../semantic/meetingArchive";
import type { MeetingArchiveStorage, MeetingArchiveSummary } from "../semantic/meetingArchiveStorage";
import { REVIEW_POLICY_VERSION } from "../semantic/reviewPolicy";
import { compareDecisionProjections } from "../semantic/meetingStateConsistency";
import { buildMeetingStateDashboard } from "../utils/meetingStateDashboard";
import type { CanonicalMeetingState, HumanCorrection, SemanticAssertion, SemanticAxes } from "../semantic/types";
import type { AnalyzedSegment, ConversationNodeRole, ConversationTreeState, DecisionMaterialStatus, DecisionSupportAnalysis, MeetingSummary, MeetingSummaryStatus, SessionLogEntry, TimedTranscriptSegment, TranscriptSegmentMetadata, TranscriptInputSource } from "../types/topic";

type TopicEngineStoreSnapshot = {
  meetingReview: MeetingReview;
  armedDiscussionPrompt: { id: string; needsResearch: boolean } | null;
  discussionPrompts: DiscussionPrompt[];
  progressRevision: number;
  progressReviewStatus: "rules" | "refining" | "ai" | "error";
  progressReviewError: string | null;
  engineState: TopicEngineState;
  conversationTree: ConversationTreeState;
  // Semantic Core state, running alongside legacy (ADR 0022 §9, ADR 0023).
  // Additive: nothing here feeds the legacy engine state.
  semantic: SemanticState;
  bufferText: string;
  // When the current speech buffer first received text, and when it last grew.
  // Both null while the buffer is empty. Used to flush on an utterance
  // boundary or a short silence instead of a fixed interval (ADR 0023 §7).
  bufferStartedAt: number | null;
  bufferUpdatedAt: number | null;
  logs: SessionLogEntry[];
  segmentArchive: AnalyzedSegment[];
  meetingSummary: MeetingSummary | null;
  meetingSummaryStatus: MeetingSummaryStatus;
  meetingSummaryError: string | null;
  meetingSummaryStale: boolean;
  meetingSummaryStartedAt: number | null;
  decisionSupport: DecisionSupportAnalysis;
  legacyEvents: import("../semantic/meetingArchive").ArchivedLegacyEvent[];
};

// The raw utterance log is the primary source; assertions and canonical state
// are derived from it. Human corrections are events in the log, not UI state --
// that is what lets them survive a re-parse (ADR 0022 §5).
type SemanticState = {
  log: MeetingEventLog;
  assertions: SemanticAssertion[];
  corrections: HumanCorrection[];
  canonical: CanonicalMeetingState;
  endedAt: number | null;
};

function createSemanticState(): SemanticState {
  return { log: createEventLog(), assertions: [], corrections: [], canonical: createCanonicalState(), endedAt: null };
}

type TopicEngineStoreOptions = {
  storage?: MeetingArchiveStorage;
  onLog?: (entry: SessionLogEntry) => void;
};

type TopicEngineStore = {
  finishMeeting: () => void;
  saveMeeting: () => Promise<{ ok: boolean; error?: string }>;
  restoreMeeting: (id: string) => Promise<{ ok: boolean; error?: string }>;
  listSavedMeetings: () => Promise<{ ok: boolean; meetings?: MeetingArchiveSummary[]; error?: string }>;
  deleteSavedMeeting: (id: string) => Promise<{ ok: boolean; error?: string; wasActive?: boolean }>;
  getArchive: () => MeetingArchive | null;
  resumeMeeting: () => void;
  reviewMinutes: (targets: ReviewTarget[], action: ReviewAction, bulk?: boolean) => Promise<ReviewResult>;
  setMeetingReview: (review: MeetingReview) => void;
  armDiscussionPrompt: (id: string | null, needsResearch?: boolean) => void;
  reviewProgress: () => Promise<void>;
  cancelProgressReview: () => void;
  answerDiscussionPrompt: (id: string, text: string, needsResearch?: boolean) => void;
  setDiscussionPromptDeferred: (id: string, deferred: boolean) => void;
  addLog: (entry: Omit<SessionLogEntry, "id" | "at"> & { at?: number }) => void;
  addTranscriptText: (text: string) => void;
  flushBuffer: () => void;
  // Flushes only when the buffer has been quiet for `idleMs`, or has been
  // accumulating for `maxAgeMs`. Cheap enough to poll; does nothing when the
  // buffer is empty.
  flushIfIdle: (idleMs: number, maxAgeMs: number) => void;
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
  // Records a per-axis human override as an event. Partial by design: axes left
  // out stay parser-derived.
  recordSemanticCorrection: (
    target: { utteranceId: string; unitId?: string },
    axes: Partial<SemanticAxes>,
    note?: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleConversationNodeRating: (nodeId: string) => void;
  updateConversationNode: (nodeId: string, patch: { role?: ConversationNodeRole; parentId?: string | null }) => void;
  updateAction: (nodeId: string, patch: ActionUpdate) => void;
  analyzeDecisionSupport: () => void;
  updateDecisionMaterialStatus: (id: string, status: DecisionMaterialStatus) => void;
  subscribe: (listener: () => void) => () => void;
};

// Owns the live engine snapshot and the command queue for speech, manual text, and replay input.

// Only explicit terminal punctuation. Deliberately does not treat polite verb
// endings (です/ます) as boundaries: Web Speech emits mid-sentence final chunks,
// and splitting on those would fragment one utterance across several segments,
// which every downstream classifier reads as separate statements.
const SENTENCE_END_PATTERN = /[。！？]$/;

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
  const archiveStorage = options.storage;
  let activeArchiveId: string | null = null;
  let legacyEvents: import("../semantic/meetingArchive").ArchivedLegacyEvent[] = [];
  let snapshot: TopicEngineStoreSnapshot = {
    meetingReview: initialMeetingReview(),
    armedDiscussionPrompt: null,
    discussionPrompts: [],
    progressRevision: 0,
    progressReviewStatus: "rules",
    progressReviewError: null,
    engineState: createInitialTopicEngineState(),
    conversationTree: createInitialConversationTreeState(),
    semantic: createSemanticState(),
    bufferText: "",
    bufferStartedAt: null,
    bufferUpdatedAt: null,
    logs: [],
    segmentArchive: [],
    meetingSummary: null,
    meetingSummaryStatus: "idle",
    meetingSummaryError: null,
    meetingSummaryStale: false,
    meetingSummaryStartedAt: null,
    decisionSupport: { status: "idle", materials: [], analyzedAt: null },
    legacyEvents: [],
  };
  const listeners = new Set<() => void>();
  let currentLlmSettings: LlmSettings | null = null;
  let titleRefineQueue: string[] = [];
  let isRefiningTitle = false;
  let sessionEpoch = 0;
  let summaryEpoch = 0;
  let progressRequest = 0;
  let progressController: AbortController | null = null;
  let lastReviewedRevision = -1;

  function flushSpeechBuffer() {
    const text = snapshot.bufferText;
    if (!text.trim()) return;
    snapshot = { ...snapshot, bufferText: "", bufferStartedAt: null, bufferUpdatedAt: null };
    processSegment(text, "speech");
  }

  // Fast path only (ADR 0023 §2): one utterance, a bounded context, no history
  // scan and no LLM. Purely additive -- it cannot alter the legacy transition it
  // is called with.
  function ingestIntoSemanticCore(current: SemanticState, segment: AnalyzedSegment, rawText: string): SemanticState {
    if (!SEMANTIC_CORE_FLAGS.core) return current;

    const appended = appendUtterance(current.log, {
      id: segment.id,
      text: rawText,
      createdAt: segment.createdAt,
      provider: segment.source === "speech" ? "web_speech" : segment.source === "replay" ? "replay" : "manual",
      speaker: segment.metadata?.speaker ?? null,
      audio: segment.metadata ? {
        startMs: segment.metadata.startMs, endMs: segment.metadata.endMs, confidence: segment.metadata.confidence,
      } : undefined,
    });
    if (appended.log === current.log) return current;

    const { assertions, relations } = runFastPath({
      utterance: appended.utterance,
      context: {
        ...emptyFastPathContext(),
        activeTopicId: snapshot.engineState.currentTopicId,
        recentUtterances: recentUtterances(current.log, FAST_PATH_CONTEXT_WINDOW),
      },
    });

    const reduced = reduceCanonical(current.canonical, {
      kind: "units_asserted",
      at: appended.utterance.createdAt,
      utterance: appended.utterance,
      assertions,
    });

    const canonical = relations.length
      ? reduceCanonical(reduced.state, { kind: "relations_asserted", relations, at: appended.utterance.createdAt }).state
      : reduced.state;
    const next = { log: appended.log, canonical };
    const synchronized = relations.some((link) => link.relation === "withdraws" || link.relation === "supersedes")
      ? synchronizeReview(next, current, snapshot.engineState.meetingGraph.meetingId, appended.utterance.createdAt, false)
      : next;
    return {
      ...current,
      ...synchronized,
      assertions: [...current.assertions, ...assertions],
      corrections: current.corrections,
    };
  }

  function refreshProgress() {
    const state = snapshot.engineState;
    snapshot = { ...snapshot, meetingReview: { ...snapshot.meetingReview, confirmations: ["", "", ""], phase: snapshot.meetingReview.phase === "complete" ? "final" : snapshot.meetingReview.phase } };
    const contributions = buildMissingContributions({ gaps: state.meetingGraph.gaps,
      topics: state.meetingGraph.nodes.filter((node) => node.id !== state.meetingGraph.rootTopicId),
      decisionGraph: state.decisionGraph, segments: snapshot.segmentArchive, currentTopicId: state.currentTopicId });
    snapshot = { ...snapshot, discussionPrompts: buildDiscussionPrompts(state.decisionGraph, snapshot.segmentArchive, contributions, snapshot.discussionPrompts),
      progressRevision: snapshot.progressRevision + 1, progressReviewStatus: "rules", progressReviewError: null };
  }

  function cancelProgressReview() {
    progressRequest += 1;
    progressController?.abort();
    progressController = null;
    lastReviewedRevision = -1;
  }

  function buildArchive(): MeetingArchive {
    const graph = snapshot.engineState.meetingGraph;
    const dashboard = buildMeetingStateDashboard(snapshot.engineState.decisionGraph, snapshot.decisionSupport.materials, null);
    const legacyTitles = new Set(dashboard.confirmedDecisions.map((entry) => entry.label));
    const canonicalTitles = new Set(entriesOfKind(snapshot.semantic.canonical, "decision")
      .filter((entry) => !entry.disposition && !entry.blocked).map((entry) => entry.label));
    const stateConsistency = compareDecisionProjections(canonicalTitles, legacyTitles);
    return {
      schemaVersion: MEETING_ARCHIVE_SCHEMA_VERSION,
      id: graph.meetingId,
      metadata: { title: graph.title, startedAt: snapshot.engineState.meetingStartedAt,
        endedAt: snapshot.semantic.endedAt ?? Date.now() },
      policyVersion: REVIEW_POLICY_VERSION,
      legacyGraph: graph,
      legacyEvents,
      events: snapshot.semantic.log.events,
      stateConsistency,
    };
  }

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

  function applyTransition(transition: TopicEngineTransition, now: number, rawText: string) {
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
    legacyEvents = [...legacyEvents, {
      id: transition.segment.id, text: rawText, createdAt: transition.segment.createdAt,
      source: transition.segment.source, speaker: transition.segment.metadata?.speaker ?? null,
    }];
    snapshot = {
      ...snapshot,
      engineState: transition.state,
      legacyEvents,
      conversationTree: appendConversationSegment(snapshot.conversationTree, transition.segment),
      // Same utterance, additionally ingested into Semantic Core. Keyed on the
      // legacy segment id so projections can join the two while both exist.
      semantic: ingestIntoSemanticCore(snapshot.semantic, transition.segment, rawText),
      // Engine state trims segments to the latest 80 for UI perf; keep the full
      // meeting here so the post-meeting report can quote every evidence segment.
      segmentArchive: [...snapshot.segmentArchive, transition.segment],
      meetingSummaryStale: snapshot.meetingSummary ? true : snapshot.meetingSummaryStale,
    };
    refreshProgress();
    emit();

    if (transition.newlyClosedTopicIds.length > 0) {
      titleRefineQueue.push(...transition.newlyClosedTopicIds);
      titleRefineQueue = [...new Set(titleRefineQueue)];
      void processTitleRefineQueue();
    }
  }

  function processSegment(text: string, source: TranscriptInputSource, metadata?: TranscriptSegmentMetadata, stableId?: string, createdAt?: number) {
    if (snapshot.semantic.endedAt !== null) return;
    const armed = snapshot.armedDiscussionPrompt;
    const prompt = armed && snapshot.discussionPrompts.find((item) => item.id === armed.id && ["open", "deferred"].includes(item.status));
    const now = Date.now();
    const transition = attachSegmentMetadata(processTopicSegment(snapshot.engineState, cleanText(text), source, createdAt ?? now, metadata), metadata);
    if (stableId) transition.segment.id = stableId;
    applyTransition(transition, now, text);
    if (armed) {
      writeSnapshot({ ...snapshot, armedDiscussionPrompt: null,
        discussionPrompts: prompt ? recordDiscussionAnswer(snapshot.discussionPrompts, prompt, transition.segment.id, armed.needsResearch) : snapshot.discussionPrompts,
        progressRevision: snapshot.progressRevision + 1 });
    }
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
    setMeetingReview(review) {
      cancelProgressReview();
      writeSnapshot({ ...snapshot, meetingReview: review, armedDiscussionPrompt: null, progressReviewStatus: "rules", progressReviewError: null });
    },
    armDiscussionPrompt(id, needsResearch = false) {
      const valid = id && snapshot.discussionPrompts.some((prompt) => prompt.id === id && ["open", "deferred"].includes(prompt.status));
      writeSnapshot({ ...snapshot, armedDiscussionPrompt: valid ? { id, needsResearch } : null });
    },
    cancelProgressReview,
    async reviewProgress() {
      if (snapshot.meetingReview.phase !== "review" || (snapshot.meetingReview.deadline ?? 0) - Date.now() <= 120_000 || progressController || lastReviewedRevision === snapshot.progressRevision || !currentLlmSettings?.model || !snapshot.discussionPrompts.some((prompt) => prompt.status === "open")) return;
      cancelProgressReview();
      const request = progressRequest;
      const revision = snapshot.progressRevision;
      lastReviewedRevision = revision;
      const controller = new AbortController();
      progressController = controller;
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const prompts = snapshot.discussionPrompts;
      const selected = planMeetingReview(prompts, ((snapshot.meetingReview.deadline ?? 0) - Date.now()) / 1000).selected;
      if (!selected.length) { clearTimeout(timeout); progressController = null; return; }
      writeSnapshot({ ...snapshot, progressReviewStatus: "refining", progressReviewError: null });
      try {
        const raw = await requestChat(currentLlmSettings, buildProgressReviewMessages(selected, snapshot.segmentArchive), { maxTokens: 1200, signal: controller.signal });
        if (request !== progressRequest || revision !== snapshot.progressRevision) return;
        writeSnapshot({ ...snapshot, discussionPrompts: applyProgressReview(raw, prompts), progressReviewStatus: "ai" });
      } catch (error) {
        if (request !== progressRequest || revision !== snapshot.progressRevision) return;
        writeSnapshot({ ...snapshot, progressReviewStatus: "error", progressReviewError: controller.signal.aborted ? "AIの応答待ちが20秒を超えたため、ルール提案を継続します。" : error instanceof Error ? error.message : String(error) });
      } finally {
        clearTimeout(timeout);
        if (request === progressRequest) progressController = null;
      }
    },
    answerDiscussionPrompt(id, text, needsResearch = false) {
      const prompt = snapshot.discussionPrompts.find((item) => item.id === id);
      const answer = cleanText(text);
      if (!prompt || !answer || !["open", "deferred"].includes(prompt.status)) return;
      snapshot = { ...snapshot, armedDiscussionPrompt: null };
      processSegment(answer, "manual");
      const answerSegmentId = snapshot.segmentArchive[snapshot.segmentArchive.length - 1].id;
      // An answer is linked by the user's explicit choice, never by AI inference.
      snapshot = { ...snapshot, discussionPrompts: recordDiscussionAnswer(snapshot.discussionPrompts, prompt, answerSegmentId, needsResearch), progressRevision: snapshot.progressRevision + 1 };
      emit();
    },
    setDiscussionPromptDeferred(id, deferred) {
      writeSnapshot({ ...snapshot, discussionPrompts: snapshot.discussionPrompts.map((prompt) => prompt.id === id ? { ...prompt, status: deferred ? "deferred" : "open" } : prompt), progressRevision: snapshot.progressRevision + 1 });
    },
    addLog,
    addTranscriptText(text) {
      if (snapshot.semantic.endedAt !== null) return;
      const nextText = cleanText(text);
      if (!nextText) return;
      const now = Date.now();
      const bufferText = [snapshot.bufferText, text].filter(Boolean).join(" ");
      addLog({
        type: "speech",
        message: "speech chunk received",
        payload: { text: nextText, source: "speech" },
      });
      writeSnapshot({
        ...snapshot,
        bufferText,
        bufferStartedAt: snapshot.bufferStartedAt ?? now,
        bufferUpdatedAt: now,
      });
      // An explicit sentence-final marker is a real utterance boundary, so the
      // segment can enter the fast path now rather than waiting for silence.
      // Japanese Web Speech usually omits punctuation, so this is an
      // opportunistic shortcut -- flushIfIdle is the mechanism that actually
      // bounds the latency.
      if (SENTENCE_END_PATTERN.test(nextText)) flushSpeechBuffer();
    },
    flushBuffer() {
      flushSpeechBuffer();
    },
    flushIfIdle(idleMs, maxAgeMs) {
      if (!snapshot.bufferText) return;
      const now = Date.now();
      const quietFor = now - (snapshot.bufferUpdatedAt ?? now);
      const bufferAge = now - (snapshot.bufferStartedAt ?? now);
      // Silence is the boundary signal. maxAgeMs is only a backstop so that a
      // speaker who never pauses still gets segmented.
      if (quietFor >= idleMs || bufferAge >= maxAgeMs) flushSpeechBuffer();
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
      activeArchiveId = null;
      legacyEvents = [];
      cancelProgressReview();
      titleRefineQueue = [];
      sessionEpoch += 1;
      summaryEpoch += 1;
      writeSnapshot({
        meetingReview: initialMeetingReview(),
        armedDiscussionPrompt: null,
        discussionPrompts: [],
        progressRevision: snapshot.progressRevision + 1,
        progressReviewStatus: "rules",
        progressReviewError: null,
        engineState: createInitialTopicEngineState(),
        conversationTree: createInitialConversationTreeState(),
        semantic: createSemanticState(),
        bufferText: "",
        bufferStartedAt: null,
        bufferUpdatedAt: null,
        logs: [],
        segmentArchive: [],
        meetingSummary: null,
        meetingSummaryStatus: "idle",
        meetingSummaryError: null,
        meetingSummaryStale: false,
        meetingSummaryStartedAt: null,
        decisionSupport: { status: "idle", materials: [], analyzedAt: null },
        legacyEvents: [],
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
      const changed = JSON.stringify(settings) !== JSON.stringify(currentLlmSettings);
      if (changed) cancelProgressReview();
      currentLlmSettings = settings;
      if (changed) { refreshProgress(); emit(); }
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
      processSegment(segment.text, "replay", {
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
      processSegment(text, source);
    },
    getArchive() {
      return snapshot.semantic.log.events.length ? buildArchive() : null;
    },
    async listSavedMeetings() {
      if (!archiveStorage) return { ok: false, error: "このブラウザーでは端末内保存を利用できません。" };
      const result = await archiveStorage.list();
      return result.ok ? { ok: true, meetings: result.value } : { ok: false, error: "保存済み会議を読み込めませんでした。" };
    },
    async saveMeeting() {
      if (!archiveStorage) return { ok: false, error: "このブラウザーでは端末内保存を利用できません。" };
      if (!snapshot.semantic.log.events.some((event) => event.kind === "utterance_added")) {
        return { ok: false, error: "発言がないため会議を保存できません。" };
      }
      const result = await archiveStorage.save(buildArchive());
      if (!result.ok) return { ok: false, error: result.error === "quota"
        ? "端末の保存容量が不足しています。会議データは保存されていません。"
        : "端末への保存に失敗しました。会議データは保存されていません。" };
      activeArchiveId = snapshot.engineState.meetingGraph.meetingId;
      return { ok: true };
    },
    async deleteSavedMeeting(id: string) {
      if (!archiveStorage) return { ok: false, error: "このブラウザーでは端末内保存を利用できません。" };
      const result = await archiveStorage.remove(id);
      if (!result.ok) return { ok: false, error: "保存済み会議を削除できませんでした。" };
      const wasActive = activeArchiveId === id;
      if (wasActive) activeArchiveId = null;
      return { ok: true, wasActive };
    },
    async restoreMeeting(id: string) {
      if (!archiveStorage) return { ok: false, error: "このブラウザーでは端末内保存を利用できません。" };
      const loaded = await archiveStorage.load(id);
      if (!loaded.ok) return { ok: false, error: loaded.error === "invalid"
        ? "保存データを検証できません。データを変更せず、復元を停止しました。"
        : "保存済み会議の読み込みに失敗しました。" };
      if (!loaded.value) return { ok: false, error: "保存済み会議が見つかりませんでした。" };
      const archive = loaded.value;
      const projection = projectMeetingArchive(archive);
      legacyEvents = archive.legacyEvents;
      const engineState = {
        ...createInitialTopicEngineState(archive.metadata.startedAt),
        meetingGraph: archive.legacyGraph,
        meetingStartedAt: archive.metadata.startedAt,
      };
      const restoredSegments: AnalyzedSegment[] = [];
      const savedUtterances = archive.events.flatMap((event) => {
        if (event.kind !== "utterance_added") return [];
        return [event.utterance];
      });
      for (const utterance of savedUtterances) {
        const source = utterance.provider === "web_speech" ? "speech" : utterance.provider === "replay" ? "replay" : "manual";
        const metadata = utterance.speaker || utterance.audio ? {
          speaker: utterance.speaker ?? undefined, startMs: utterance.audio?.startMs, endMs: utterance.audio?.endMs,
          confidence: utterance.audio?.confidence,
        } : undefined;
        const transition = attachSegmentMetadata(processTopicSegment(engineState, utterance.text, source, utterance.createdAt, metadata), metadata);
        transition.segment.id = utterance.id;
        Object.assign(engineState, transition.state);
        restoredSegments.push(transition.segment);
      }
      engineState.meetingGraph = archive.legacyGraph;
      const finalEngineState = { ...engineState, meetingGraph: archive.legacyGraph, segments: restoredSegments,
        segmentCount: restoredSegments.length };
      const conversationTree = restoredSegments.reduce((tree, segment) =>
        appendConversationSegment(tree, segment), createInitialConversationTreeState());
      const assertions = projection.assertions;
      const corrections = archive.events.flatMap((event) => event.kind === "human_correction" ? [event.correction] : []);
      const canonical = projection.canonical;
      const log: MeetingEventLog = { events: archive.events, policyVersion: archive.policyVersion,
        nextSeq: Math.max(0, ...restoredSegments.map((segment, i) => i + 1)) + 1 };
      legacyEvents = archive.legacyEvents;
      snapshot = {
        ...snapshot,
        legacyEvents,
        engineState: finalEngineState,
        conversationTree,
        segmentArchive: restoredSegments as AnalyzedSegment[],
        semantic: { log, assertions, corrections, canonical, endedAt: archive.metadata.endedAt },
        bufferText: "",
        bufferStartedAt: null,
        bufferUpdatedAt: null,
        meetingSummary: null,
        meetingSummaryStatus: "idle",
        meetingSummaryError: null,
        meetingSummaryStale: false,
        decisionSupport: { status: "idle", materials: [], analyzedAt: null },
      };
      activeArchiveId = archive.id;
      refreshProgress();
      emit();
      return { ok: true };
    },
    finishMeeting() {
      if (snapshot.semantic.endedAt !== null) return;
      flushSpeechBuffer();
      const at = Date.now();
      const current = snapshot.semantic;
      const next = { ...current, endedAt: at };
      const reviewed = synchronizeReview(next, current, snapshot.engineState.meetingGraph.meetingId, at, true);
      writeSnapshot({ ...snapshot, semantic: { ...next, ...reviewed } });
    },
    resumeMeeting() {
      if (snapshot.semantic.endedAt === null) return;
      writeSnapshot({ ...snapshot, semantic: { ...snapshot.semantic, endedAt: null } });
    },
    async reviewMinutes(targets, action, bulk) {
      if (snapshot.semantic.endedAt === null) return { ok: false, message: "会議を終了してから確認してください。" };
      const current = snapshot.semantic;
      const result = applyReviewAction(current, snapshot.engineState.meetingGraph.meetingId, targets, action, Date.now(), bulk);
      if (result.ok) {
        const nextSemantic = { ...current, ...result.state, corrections: result.state.canonical.corrections };
        if (activeArchiveId) {
          const prior = snapshot;
          snapshot = { ...snapshot, semantic: nextSemantic };
          const saved = await archiveStorage!.save(buildArchive());
          if (!saved.ok) {
            snapshot = prior;
            return { ok: false, message: saved.error === "quota" ? "端末の保存容量が不足しています。" : "変更を端末へ保存できませんでした。" };
          }
        }
        writeSnapshot({ ...snapshot, semantic: nextSemantic });
        return { ok: true };
      }
      return { ok: false, message: result.message };
    },
    async recordSemanticCorrection(target, axes, note = null) {
      if (Object.keys(axes).length === 0) return { ok: true };
      const correction: HumanCorrection = {
        id: createId("correction"),
        at: Date.now(),
        target,
        axes,
        note,
      };
      const current = snapshot.semantic;
      const revised = applyItemCorrection(current, correction, snapshot.engineState.meetingGraph.meetingId);
      writeSnapshot({
        ...snapshot,
        semantic: { ...current, ...revised, corrections: revised.canonical.corrections },
      });
      if (activeArchiveId && archiveStorage) {
        const saved = await archiveStorage.save(buildArchive());
        if (!saved.ok) return { ok: false, error: saved.error === "quota"
          ? "端末の保存容量が不足しています。訂正は画面上に残っていますが、保存されていません。"
          : "訂正を端末へ保存できませんでした。訂正は画面上に残っています。" };
      }
      return { ok: true };
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
    updateAction(nodeId, patch) {
      const decisionGraph = updateMeetingAction(snapshot.engineState.decisionGraph, nodeId, patch, {
        id: createId("action-update"), createdAt: Date.now(),
      });
      if (decisionGraph === snapshot.engineState.decisionGraph) return;
      snapshot = { ...snapshot, engineState: { ...snapshot.engineState, decisionGraph }, meetingSummaryStale: true };
      refreshProgress();
      emit();
    },
    analyzeDecisionSupport() {
      const materials = analyzeDecisionMaterials(snapshot.segmentArchive, snapshot.decisionSupport.materials);
      writeSnapshot({ ...snapshot, decisionSupport: { status: materials.length ? "ready" : "insufficient_evidence", materials, analyzedAt: Date.now() } });
    },
    updateDecisionMaterialStatus(id, status) {
      writeSnapshot({ ...snapshot, decisionSupport: { ...snapshot.decisionSupport, materials: updateDecisionMaterialStatus(snapshot.decisionSupport.materials, id, status) } });
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
