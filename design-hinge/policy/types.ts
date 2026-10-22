export type TriggerType = "silence" | "stagnation" | "graph_gap" | "contradiction" | "counterfactual" | "manual";
export type InterventionForm = "question" | "counterfactual_card";

export type InterventionCandidate = {
  id: string;
  triggerType: TriggerType;
  createdAtMs: number;
  reasonCode: string;
  reasonSummary: string;
  relatedNodeIds: string[];
  relatedEdgeIds: string[];
  confidence: number;
  form: InterventionForm;
};

export type PhrasingSource = "template" | "llm";

export type InterventionCard = InterventionCandidate & {
  questionText: string;
  phrasingSource: PhrasingSource;
};

export type InterventionOutcome = "delivered" | "accepted" | "dismissed" | "shadow_only";
