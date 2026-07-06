import type { Edge, Node } from "@xyflow/react";

export type TranscriptInputSource = "speech" | "manual" | "replay";

export type TimedTranscriptWord = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type TimedTranscriptSegment = {
  id: string;
  startMs: number;
  endMs?: number;
  speaker?: string;
  text: string;
  source: "official_transcript" | "offline_stt" | "manual_replay" | "audio_replay";
  confidence?: number;
  words?: TimedTranscriptWord[];
  raw?: unknown;
};

export type TranscriptSegmentMetadata = {
  speaker?: string;
  startMs?: number;
  endMs?: number;
  transcriptSource?: TimedTranscriptSegment["source"];
  confidence?: number;
  words?: TimedTranscriptWord[];
  raw?: unknown;
};

export type TopicCoverageKey =
  | "decision"
  | "reason"
  | "owner"
  | "dueDate"
  | "risk"
  | "alternative"
  | "objection"
  | "nextAction"
  | "dependency"
  | "openQuestionResolved";

export type TopicCoverage = Record<TopicCoverageKey, boolean>;

export type TopicLifecycle = "active" | "discussed" | "decided" | "unresolved";

export type TopicDisplayState = "active" | "discussed" | "shallow" | "missing" | "decided" | "unresolved";

export type TopicEdgeType = "parent" | "related" | "depends_on" | "contradicts" | "follow_up" | "missing_of";

export type TopicGapType =
  | "shallow"
  | "missing_decision"
  | "missing_reason"
  | "missing_owner"
  | "missing_due_date"
  | "missing_next_action"
  | "missing_risk"
  | "missing_alternative"
  | "unresolved";

export type TopicGapSeverity = "high" | "medium" | "low";

export type TopicNode = {
  id: string;
  title: string;
  aliases: string[];
  lifecycle: TopicLifecycle;
  displayStates: TopicDisplayState[];
  coverage: TopicCoverage;
  evidenceSegmentIds: string[];
  mentionCount: number;
  openQuestionCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastActivatedAt: number | null;
  closedAt: number | null;
  lastActivatedSegmentIndex: number;
};

export type TopicEdge = {
  id: string;
  source: string;
  target: string;
  type: TopicEdgeType;
};

export type TopicGap = {
  id: string;
  topicId: string;
  type: TopicGapType;
  title: string;
  detail: string;
  severity: TopicGapSeverity;
  createdAt: number;
  closedAt: number | null;
};

export type MeetingGapSummary = {
  gaps: TopicGap[];
  updatedAt: number | null;
};

export type MeetingGraph = {
  meetingId: string;
  title: string;
  rootTopicId: string;
  nodes: TopicNode[];
  edges: TopicEdge[];
  gaps: TopicGap[];
  gapSummary: MeetingGapSummary;
};

export type FocusState = {
  focusTopicId: string | null;
  focusLabel: string | null;
  focusSetBy: "auto" | "manual";
  locked: boolean;
  startedAt: number;
  goal?: string;
};

export type FocusRelation = "on_focus" | "adjacent" | "off_topic_important" | "off_topic_noise" | "uncertain";

export type UtteranceIntent =
  | "question"
  | "concern"
  | "todo"
  | "decision"
  | "agreement"
  | "correction"
  | "switch_topic"
  | "unknown";

export type TopicPhraseCandidate = {
  phrase: string;
  clause: string;
  reason: string;
};

export type TopicMatchCandidate = {
  topicId: string;
  label: string;
  score: number;
  reason: string;
};

export type CoverageUpdate = {
  key: TopicCoverageKey;
  matchedText: string;
};

export type ResolvedReference = {
  phrase: string;
  candidateTopicId: string | null;
  confidence: number;
  reason: string;
};

export type TranscriptSegment = {
  id: string;
  text: string;
  createdAt: number;
  source: TranscriptInputSource;
  matchedTopicIds: string[];
  metadata?: TranscriptSegmentMetadata;
};

export type AnalyzedSegment = TranscriptSegment & {
  analysis: {
    selectedTopicId: string | null;
    selectedTopicLabel: string | null;
    matchedTopicIds: string[];
    intent: UtteranceIntent;
    focusRelation: FocusRelation;
    focusAlignmentScore: number;
    candidateTopicPhrases: TopicPhraseCandidate[];
    topicScores: TopicMatchCandidate[];
    resolvedReferences: ResolvedReference[];
    unresolvedReferences: string[];
    shouldUpdateGraph: boolean;
    shouldUpdateCurrentTopic: boolean;
    shouldCreateNode: boolean;
    coverageUpdates: CoverageUpdate[];
    createdGapIds: string[];
    reason: string;
  };
};

export type TopicDecisionLog = {
  segmentId: string;
  text: string;
  source: TranscriptInputSource;
  intent: UtteranceIntent;
  topicScores: TopicMatchCandidate[];
  selectedTopicId: string | null;
  unresolvedReferences: string[];
  coverageUpdates: CoverageUpdate[];
  createdAt: number;
};

export type ImportantMention = {
  id: string;
  segmentId: string;
  text: string;
  type: "problem" | "risk" | "todo" | "decision" | "question";
  relatedTopicId: string | null;
  confidence: number;
};

export type SessionLogEntry = {
  id: string;
  type: "speech" | "segment" | "topic" | "system" | "websocket" | "decision";
  at: number;
  message: string;
  payload?: unknown;
};

export type SpeechStatus = "idle" | "listening" | "unsupported" | "error";

export type GraphTopicNodeData = {
  label: string;
  kind: "root" | "topic" | "gap";
  states: TopicDisplayState[];
  lifecycle?: TopicLifecycle;
  mentionCount?: number;
  evidence?: string;
  detail?: string;
  isActive?: boolean;
};

export type TopicGraphNode = Node<GraphTopicNodeData, "topic">;

export type TopicGraphEdgeData = {
  relation: TopicEdgeType;
};

export type TopicGraphEdge = Edge<TopicGraphEdgeData>;
