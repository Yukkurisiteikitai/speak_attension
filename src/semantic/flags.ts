// Per-phase rollback switches (ADR 0023 §8.2).
//
// One flag is flipped per migration phase. Turning a flag off restores the
// legacy path for that surface without touching the others, and without any data
// migration: the raw utterance log is a superset of what legacy consumes.

export type SemanticCoreFlags = {
  // Layer 1-4 run in the store at all. Off means nothing is computed.
  core: boolean;
  // Phase 2: the Timeline renders a projection of semantic state.
  timeline: boolean;
  // Phase 3: provisional Meeting State comes from the canonical reducer.
  meetingState: boolean;
  // Phase 4: decisionGraph / conversationTree become projections.
  decisionGraph: boolean;
  // Phase 5: topic / progress consumers read canonical state.
  topicProgress: boolean;
};

export const SEMANTIC_CORE_FLAGS: SemanticCoreFlags = {
  core: true,
  timeline: true,
  meetingState: false,
  decisionGraph: false,
  topicProgress: false,
};
