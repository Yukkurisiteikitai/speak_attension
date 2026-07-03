import type { Edge, Node } from "@xyflow/react";

export type TopicNodeData = {
  label: string;
  heat: number;
  keywords: string[];
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
  startedAt: number;
  goal?: string;
};

export type FocusRelation = "on_focus" | "adjacent" | "off_topic_important" | "off_topic_noise" | "uncertain";

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
  matchedKeywords: string[];
  topicScores: {
    topicId: string;
    label: string;
    score: number;
    reason: string;
  }[];
  selectedTopicId: string | null;
  unresolvedReferences: string[];
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

export type AnalyzedSegment = TranscriptSegment & {
  analysis: {
    selectedTopicId: string | null;
    selectedTopicLabel: string | null;
    matchedTopicIds: string[];
    matchedKeywords: string[];
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
