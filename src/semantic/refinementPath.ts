// Refinement path scaffolding (ADR 0023 §3, §8).
//
// Phase 1 provides the types and the guards that decide whether a late result
// may be applied. It does NOT implement pronoun resolution, multi-utterance
// relations, long-context interpretation or LLM inference: those arrive in
// Phase 5, deliberately after the fast path is stable, so that async conflict
// resolution is not debugged at the same time as segmentation.

import type { CanonicalMeetingState, HumanCorrection, RefinementJob } from "./types";

export type RefinementRejection =
  // Something the job read has changed since it started.
  | "stale_entity"
  // A person has corrected this utterance; machine output never overrides that.
  | "human_corrected"
  | "unknown_entity";

export type RefinementDecision =
  | { applicable: true }
  | { applicable: false; rejection: RefinementRejection; entityId: string | null };

// A job is applicable only when every entity it read is still at the revision it
// read. Order of arrival therefore cannot matter: a result built on a superseded
// reading is rejected rather than merged.
export function canApplyRefinement(
  job: RefinementJob,
  state: CanonicalMeetingState,
  corrections: HumanCorrection[],
): RefinementDecision {
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const correctedUtterances = new Set(corrections.map((correction) => correction.target.utteranceId));

  for (const read of job.readEntities) {
    const entry = byId.get(read.entityId);
    if (!entry) return { applicable: false, rejection: "unknown_entity", entityId: read.entityId };
    if (entry.entityRevision !== read.entityRevision) {
      return { applicable: false, rejection: "stale_entity", entityId: read.entityId };
    }
    // Human corrections win unconditionally (ADR 0022 §5).
    if (entry.evidence.utteranceIds.some((utteranceId) => correctedUtterances.has(utteranceId))) {
      return { applicable: false, rejection: "human_corrected", entityId: read.entityId };
    }
  }

  return { applicable: true };
}

// Phase 1 intentionally ships no refinement engines. Kept as an explicit,
// testable statement so "not implemented yet" cannot be mistaken for "lost".
export const IMPLEMENTED_REFINEMENTS: readonly string[] = [];

export const PLANNED_REFINEMENTS = [
  "pronoun_reference_resolution",
  "multi_utterance_relations",
  "long_context_interpretation",
  "ambiguous_option_vs_proposal",
  "global_consistency_reconciliation",
] as const;
