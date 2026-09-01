import type { HingeEdge, HingeNode, TestStatus } from "../graph/types";
import type { GraphDiffResult } from "../graph/graphDiff";
import type { InterventionCandidate, InterventionCard } from "../policy/types";

// Subset of deep_research.md's event list (line ~522-548), reinterpreted for
// what's actually observable through browser Web Speech API + no VAD + no TTS:
//
// Kept as-is: session_started/ended, node_proposed/created/corrected/merged/
//   split, edge_proposed/accepted/rejected, intervention_eligible/delivered/
//   accepted/dismissed, counterfactual_created, hypothesis_tested.
// Renamed: transcript_final -> utterance_ingested (Web Speech API only exposes
//   final text via onFinalText, never delta/completed streaming events).
// Dropped: transcript_delta (no streaming deltas), speech_started/stopped (no
//   VAD), intervention_randomized (no Micro-Randomized Trial), intervention_
//   interrupted (no TTS to interrupt), phase_change_* (Phase-Aware trigger
//   deferred past MVP), questionnaire_completed (no human-subjects instruments
//   in scope).
export type TranscriptInputSource = "speech" | "manual" | "replay";

export type DesignHingeEventBase = {
  id: string;
  sessionId: string;
  atMs: number;
};

export type DesignHingeEvent =
  | (DesignHingeEventBase & { type: "session_started" })
  | (DesignHingeEventBase & { type: "session_ended" })
  | (DesignHingeEventBase & { type: "utterance_ingested"; text: string; source: TranscriptInputSource })
  | (DesignHingeEventBase & { type: "node_proposed"; node: HingeNode })
  | (DesignHingeEventBase & { type: "node_created"; nodeId: string })
  | (DesignHingeEventBase & { type: "node_corrected"; nodeId: string; patch: Partial<HingeNode> })
  | (DesignHingeEventBase & { type: "node_merged"; intoNodeId: string; fromNodeIds: string[] })
  | (DesignHingeEventBase & { type: "node_split"; fromNodeId: string; intoNodeIds: string[] })
  | (DesignHingeEventBase & { type: "edge_proposed"; edge: HingeEdge })
  | (DesignHingeEventBase & { type: "edge_accepted"; edgeId: string })
  | (DesignHingeEventBase & { type: "edge_rejected"; edgeId: string })
  | (DesignHingeEventBase & { type: "intervention_eligible"; candidate: InterventionCandidate })
  | (DesignHingeEventBase & { type: "intervention_delivered"; card: InterventionCard })
  | (DesignHingeEventBase & { type: "intervention_accepted"; cardId: string })
  | (DesignHingeEventBase & { type: "intervention_dismissed"; cardId: string; reason: "user" | "timeout" | "superseded" })
  | (DesignHingeEventBase & { type: "counterfactual_created"; nodeId?: string; edgeId?: string; diff: GraphDiffResult })
  | (DesignHingeEventBase & { type: "hypothesis_tested"; edgeId: string; testStatus: TestStatus });

export type DesignHingeEventType = DesignHingeEvent["type"];
