export type ConfidenceDisplayMode = "hidden" | "three_tier" | "numeric";

export type PolicyParameters = {
  silenceThresholdMs: number;
  minInterventionIntervalMs: number;
  stagnationWindowSize: number;
  // Originally a semantic/embedding similarity threshold in deep_research.md;
  // here it gates graph/textSimilarity.ts's jaccardSimilarity (token overlap),
  // a different scale, so 0.85 is a starting point to recalibrate locally,
  // not a carried-over constant.
  stagnationSimilarityThreshold: number;
  isolatedNodeThreshold: number;
  causalConfidenceThreshold: number;
  maxQuestionsPerCard: number;
  counterfactualVariantCount: number;
  confidenceDisplayMode: ConfidenceDisplayMode;
};

// Fixed string, bumped manually per deep_research.md's own rule
// ("モデル・プロンプト・ポリシー版を固定する") — never auto-incremented at runtime.
export const POLICY_VERSION = "policy_0.1";

export const DEFAULT_POLICY_PARAMETERS: PolicyParameters = {
  silenceThresholdMs: 6000,
  minInterventionIntervalMs: 45000,
  stagnationWindowSize: 3,
  stagnationSimilarityThreshold: 0.85,
  isolatedNodeThreshold: 2,
  causalConfidenceThreshold: 0.8,
  maxQuestionsPerCard: 1,
  counterfactualVariantCount: 3,
  confidenceDisplayMode: "three_tier",
};
