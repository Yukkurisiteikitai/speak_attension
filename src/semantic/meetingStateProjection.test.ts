import { describe, expect, it } from "vitest";
import { createCanonicalState } from "./canonicalReducer";
import { PROJECTED_KINDS, projectMeetingState } from "./meetingStateProjection";
import { runSidecarCase } from "./runSidecar";
import { loadCorpus } from "./__corpus__/loadCorpus";
import type { CanonicalKind } from "./types";

function caseById(id: string) {
  const testCase = loadCorpus().find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`corpus case ${id} not found`);
  return testCase;
}

describe("projectMeetingState", () => {
  it("returns empty buckets for an empty canonical state", () => {
    const projection = projectMeetingState(createCanonicalState());

    for (const bucket of Object.values(projection)) {
      expect(bucket).toEqual([]);
    }
  });

  it("places an explicit decision in confirmedDecisions", () => {
    const { canonical } = runSidecarCase(caseById("09-decision-explicit"));
    const projection = projectMeetingState(canonical);

    expect(projection.confirmedDecisions.length).toBeGreaterThan(0);
    expect(projection.confirmedDecisions.every((entry) => entry.basis !== "provisional")).toBe(true);
  });

  it("never places a process greeting in decisions or actions (I4)", () => {
    const { canonical } = runSidecarCase(caseById("18-process-greeting"));
    const projection = projectMeetingState(canonical);

    expect(projection.confirmedDecisions).toEqual([]);
    expect(projection.actions).toEqual([]);
  });

  it("keeps provisional decisions visible but out of confirmedDecisions (I6)", () => {
    const { canonical } = runSidecarCase(caseById("09-decision-explicit"));
    const projection = projectMeetingState(canonical);
    const decisionEntries = canonical.entries.filter((entry) => entry.kind === "decision");

    expect(projection.confirmedDecisions.length + projection.provisionalDecisions.length)
      .toBe(decisionEntries.length);
  });

  it("does not drop any entry: every canonical entry lands in some bucket", () => {
    const { canonical } = runSidecarCase(caseById("19-explicitly-undecided"));
    const projection = projectMeetingState(canonical);
    const placed = [
      ...projection.confirmedDecisions,
      ...projection.provisionalDecisions,
      ...projection.actions,
      ...projection.deferred,
      ...projection.questions,
      ...projection.unresolved,
      ...projection.proposals,
      ...projection.options,
      ...projection.problems,
      ...projection.topics,
      ...projection.context,
    ];

    expect(placed.length).toBe(canonical.entries.length);
  });
});

describe("PROJECTED_KINDS", () => {
  // Exhaustive over CanonicalKind: adding a kind to types.ts is a compile error
  // here until this record and PROJECTED_KINDS are updated together.
  it("lists every CanonicalKind exactly once", () => {
    const everyKind: Record<CanonicalKind, true> = {
      topic: true, context: true, problem: true, option: true, proposal: true,
      decision: true, action: true, deferred: true, question: true, unresolved: true,
    };

    expect([...PROJECTED_KINDS].sort()).toEqual(Object.keys(everyKind).sort());
  });
});
