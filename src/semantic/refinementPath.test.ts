import { describe, expect, it } from "vitest";
import { canApplyRefinement, IMPLEMENTED_REFINEMENTS, PLANNED_REFINEMENTS } from "./refinementPath";
import { createCanonicalState, reduceCanonical } from "./canonicalReducer";
import { emptyFastPathContext, runFastPath } from "./fastPath";
import { createRawUtterance } from "./rawUtterance";
import type { CanonicalMeetingState, HumanCorrection, RefinementJob } from "./types";

function stateWith(text: string): CanonicalMeetingState {
  const utterance = createRawUtterance({ id: "u1", text, createdAt: 1_000, provider: "manual" }, 1);
  const { assertions } = runFastPath({ utterance, context: emptyFastPathContext() });
  return reduceCanonical(createCanonicalState(), { kind: "units_asserted", at: 1_000, utterance, assertions }).state;
}

const jobFor = (state: CanonicalMeetingState): RefinementJob => ({
  id: "job-1",
  basedOnRevision: state.revision,
  readEntities: state.entries.map((entry) => ({ entityId: entry.id, entityRevision: entry.entityRevision })),
});

describe("refinement path guards (ADR 0023 §8)", () => {
  it("applies when every entity it read is unchanged", () => {
    const state = stateWith("課題は集客です");
    expect(canApplyRefinement(jobFor(state), state, [])).toEqual({ applicable: true });
  });

  it("rejects when an entity it read has moved on", () => {
    const state = stateWith("課題は集客です");
    const job = jobFor(state);
    const moved = reduceCanonical(state, { kind: "human_confirmation", at: 2_000, entityId: state.entries[0].id });
    const decision = canApplyRefinement(job, moved.state, []);
    expect(decision).toMatchObject({ applicable: false, rejection: "stale_entity" });
  });

  it("rejects when a person has corrected the utterance behind the entity", () => {
    const state = stateWith("課題は集客です");
    const corrections: HumanCorrection[] = [
      { id: "c1", at: 1_500, target: { utteranceId: "u1" }, axes: { role: "option" }, note: null },
    ];
    const decision = canApplyRefinement(jobFor(state), state, corrections);
    expect(decision).toMatchObject({ applicable: false, rejection: "human_corrected" });
  });

  it("rejects when an entity it read no longer exists", () => {
    const state = stateWith("課題は集客です");
    const job: RefinementJob = { id: "job-1", basedOnRevision: state.revision, readEntities: [{ entityId: "gone", entityRevision: 1 }] };
    expect(canApplyRefinement(job, state, [])).toMatchObject({ applicable: false, rejection: "unknown_entity" });
  });

  it("ships no refinement engines in Phase 1, and says which are planned", () => {
    expect(IMPLEMENTED_REFINEMENTS).toEqual([]);
    expect(PLANNED_REFINEMENTS).toContain("pronoun_reference_resolution");
  });
});
