import type { Edge, Node } from "@xyflow/react";

export type TopicNodeData = {
  label: string;
  heat: number;
  keywords: string[];
  normalizedTerms: string[];
  lastTouchedAt: number | null;
  evidence: string[];
};

export type GraphTopicNodeData = TopicNodeData & {
  isActive?: boolean;
};

export type TopicGraphNode = Node<TopicNodeData, "topic">;

export type TopicGraphEdge = Edge;

export type TranscriptInputSource = "speech" | "manual" | "replay";

export type TranscriptSegment = {
  id: string;
  text: string;
  createdAt: number;
  source: TranscriptInputSource;
  matchedTopicIds: string[];
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

export type ConversationContext = {
  activeTopicId: string | null;
  recentTopicIds: string[];
  recentSegments: TranscriptSegment[];
};

export type ResolvedReference = {
  phrase: string;
  candidateTopicId: string | null;
  confidence: number;
  reason: string;
};

export type TopicDecisionLog = {
  segmentId: string;
  text: string;
  source: TranscriptInputSource;
  intent: UtteranceIntent;
  matchedKeywords: string[];
  matchedSynonyms: string[];
  topicScores: TopicScoreBreakdown[];
  selectedTopicId: string | null;
  unresolvedReferences: string[];
  createdAt: number;
};

export type TopicScoreBreakdown = {
  topicId: string;
  label: string;
  total: number;
  keywordScore: number;
  synonymScore: number;
  focusContextScore: number;
  intentScore: number;
  recencyScore: number;
  matchedKeywords: string[];
  matchedSynonyms: string[];
  reason: string;
};

export type ImportantMention = {
  id: string;
  segmentId: string;
  text: string;
  type: "problem" | "risk" | "todo" | "decision" | "question";
  relatedTopicId: string | null;
  confidence: number;
};

export type AnalyzedSegment = TranscriptSegment & {
  analysis: {
    selectedTopicId: string | null;
    selectedTopicLabel: string | null;
    matchedTopicIds: string[];
    matchedKeywords: string[];
    matchedSynonyms: string[];
    intent: UtteranceIntent;
    topicScores: TopicScoreBreakdown[];
    focusRelation: FocusRelation;
    focusAlignmentScore: number;
    importanceType: ImportantMention["type"] | null;
    resolvedReferences: ResolvedReference[];
    unresolvedReferences: string[];
    shouldUpdateGraph: boolean;
    shouldUpdateCurrentTopic: boolean;
    shouldCreateNode: boolean;
    reason: string;
  };
};

export type SessionLogEntry = {
  id: string;
  type: "speech" | "segment" | "topic" | "system" | "websocket" | "decision";
  at: number;
  message: string;
  payload?: unknown;
};

export type SpeechStatus = "idle" | "listening" | "unsupported" | "error";
