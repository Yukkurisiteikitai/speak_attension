import { describe, expect, it } from "vitest";
import { planMeetingReview } from "./meetingReview";
import type { DiscussionPrompt } from "./meetingProgress";
const prompt = (id: string, kind: string, status: DiscussionPrompt["status"] = "open"): DiscussionPrompt => ({ id, kind, status, question: id, rationale: "根拠", anchorSegmentId: "s1", evidenceSegmentIds: ["s1"], actionId: null, branches: [], source: "rules" });

describe("time bounded meeting review", () => {
  it("prioritizes uncertainty and decisions, reserves final time, and keeps carryover", () => {
    const prompts = [prompt("compare", "compare"), prompt("owner", "missing_owner"), prompt("verify", "verify"), prompt("decision", "missing_decision"), prompt("later", "verify", "deferred"), prompt("done", "verify", "answered")];
    const before = structuredClone(prompts);
    const plan = planMeetingReview(prompts, 300);
    expect(plan.selected.map((p) => p.id)).toEqual(["verify", "decision", "owner"]);
    expect(plan.carryover.map((p) => p.id)).toEqual(["compare", "later"]);
    expect(prompts).toEqual(before);
  });
  it("handles short, expired and invalid budgets without discarding unanswered items", () => {
    const prompts = [prompt("a", "verify")];
    for (const seconds of [120, 0, -1, NaN, Infinity]) {
      expect(planMeetingReview(prompts, seconds)).toEqual({ selected: [], carryover: prompts });
    }
  });
  it("moves to the next question after answers and deferrals without starving important gaps", () => {
    const prompts = [prompt("a", "verify", "answered"), prompt("b", "verify", "deferred"), prompt("c", "missing_owner"), prompt("d", "followup")];
    expect(planMeetingReview(prompts, 180).selected.map((p) => p.id)).toEqual(["c"]);
    expect(planMeetingReview(prompts, 240).selected.map((p) => p.id)).toEqual(["c", "d"]);
  });
});
