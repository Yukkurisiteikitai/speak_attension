// Design Hinge causal graph model.
// Edge attribute vocabulary follows deep_research.md's "標準因果モデル" table
// (relation / confidence / evidence_type / provenance / test_status / scope / counterfactual).

export type OriginKind = "human" | "ai_hypothesis" | "co_edited";

export type RelationKind =
  | "causes"
  | "enables"
  | "blocks"
  | "depends_on"
  | "contradicts"
  | "transforms";

export type EvidenceType =
  | "direct_rule"
  | "user_hypothesis"
  | "ai_inference"
  | "prior_research"
  | "playtest";

export type TestStatus =
  | "untested"
  | "falsification_in_progress"
  | "partially_supported"
  | "supported"
  | "rejected";

export type Scope = "this_work_only" | "similar_works" | "general_hypothesis";

// Default vocabulary follows deep_research.md's standard causal chain
// (rule -> action -> info_topology -> goal -> cognitive_challenge -> strategy
//  -> social_trust -> emotional_reward -> narrative, plus uncertainty).
// "custom" exists because that chain is specific to the doc's game-design
// worked example and shouldn't be forced onto every session.
export type HingeNodeType =
  | "rule"
  | "action"
  | "info_topology"
  | "goal"
  | "uncertainty"
  | "cognitive_challenge"
  | "strategy"
  | "social_trust"
  | "emotional_reward"
  | "narrative"
  | "custom";

export type HingeNode = {
  id: string;
  sessionId: string;
  type: HingeNodeType;
  label: string;
  content: string;
  origin: OriginKind;
  confidence: number;
  createdAtMs: number;
  sourceSegmentId: string | null;
  policyVersion: string;
};

export type HingeEdge = {
  id: string;
  source: string;
  target: string;
  relation: RelationKind;
  confidence: number;
  evidenceType: EvidenceType;
  provenance: OriginKind;
  testStatus: TestStatus;
  scope: Scope;
  counterfactual: boolean;
  createdAtMs: number;
};

export type HingeGraph = {
  sessionId: string;
  nodes: HingeNode[];
  edges: HingeEdge[];
};

export type NewHingeNodeInput = {
  type: HingeNodeType;
  label: string;
  content: string;
  origin: OriginKind;
  confidence: number;
  sourceSegmentId: string | null;
  policyVersion: string;
};

export type NewHingeEdgeInput = {
  source: string;
  target: string;
  relation: RelationKind;
  confidence: number;
  evidenceType: EvidenceType;
  provenance: OriginKind;
  testStatus: TestStatus;
  scope: Scope;
  counterfactual?: boolean;
};
