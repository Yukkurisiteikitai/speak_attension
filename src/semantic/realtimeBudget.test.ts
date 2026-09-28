import { describe, expect, it } from "vitest";
import { REALTIME_BUDGETS_MS, evaluateStage, firstBreachingLength } from "./realtimeBudget";

describe("realtimeBudget", () => {
  it("treats a measurement exactly on the budget as within budget", () => {
    const verdict = evaluateStage({ stage: "fastSemantic", p95Ms: REALTIME_BUDGETS_MS.fastSemantic, utteranceCount: 100 });
    expect(verdict.withinBudget).toBe(true);
    expect(verdict.utilization).toBe(1);
  });

  it("reports over-budget with utilization above 1", () => {
    const verdict = evaluateStage({ stage: "provisionalMeetingState", p95Ms: 400, utteranceCount: 1600 });
    expect(verdict.withinBudget).toBe(false);
    expect(verdict.utilization).toBeCloseTo(2);
  });

  it("returns the smallest meeting length that breaches, not the largest", () => {
    const breach = firstBreachingLength([
      { stage: "provisionalMeetingState", p95Ms: 10, utteranceCount: 100 },
      { stage: "provisionalMeetingState", p95Ms: 900, utteranceCount: 3200 },
      { stage: "provisionalMeetingState", p95Ms: 250, utteranceCount: 1600 },
    ]);
    expect(breach).toBe(1600);
  });

  it("returns null when every measured length stays within budget", () => {
    expect(firstBreachingLength([
      { stage: "timelineRender", p95Ms: 1, utteranceCount: 100 },
      { stage: "timelineRender", p95Ms: 2, utteranceCount: 3200 },
    ])).toBeNull();
  });
});
