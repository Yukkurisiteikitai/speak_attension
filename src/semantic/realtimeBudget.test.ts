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

  it("budgets the progress map separately from, and below, the meeting state", () => {
    expect(REALTIME_BUDGETS_MS.progressMapRender).toBeLessThan(REALTIME_BUDGETS_MS.provisionalMeetingState);
  });

  it("sets the total budget to the sum of the two state budgets", () => {
    expect(REALTIME_BUDGETS_MS.totalVisibleUpdate).toBe(
      REALTIME_BUDGETS_MS.provisionalMeetingState + REALTIME_BUDGETS_MS.progressMapRender,
    );
  });

  it("flags a total that breaches even when every split stage passes", () => {
    // The point of keeping a total alongside the split stages: three stages can
    // each sit inside their own budget while the sum the user waits for does not.
    const splitStagesPass = [
      evaluateStage({ stage: "timelineRender", p95Ms: 40, utteranceCount: 2000 }),
      evaluateStage({ stage: "provisionalMeetingState", p95Ms: 190, utteranceCount: 2000 }),
      evaluateStage({ stage: "progressMapRender", p95Ms: 95, utteranceCount: 2000 }),
    ];
    expect(splitStagesPass.every((verdict) => verdict.withinBudget)).toBe(true);

    const total = evaluateStage({ stage: "totalVisibleUpdate", p95Ms: 40 + 190 + 95, utteranceCount: 2000 });
    expect(total.withinBudget).toBe(false);
  });

  it("returns null when every measured length stays within budget", () => {
    expect(firstBreachingLength([
      { stage: "timelineRender", p95Ms: 1, utteranceCount: 100 },
      { stage: "timelineRender", p95Ms: 2, utteranceCount: 3200 },
    ])).toBeNull();
  });
});
