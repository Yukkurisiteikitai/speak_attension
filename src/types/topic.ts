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

export type TranscriptSegment = {
  id: string;
  text: string;
  createdAt: number;
  matchedTopicIds: string[];
};

export type SessionLogEntry = {
  id: string;
  type: "speech" | "segment" | "topic" | "system" | "websocket";
  at: number;
  message: string;
  payload?: unknown;
};

export type SpeechStatus = "idle" | "listening" | "unsupported" | "error";
