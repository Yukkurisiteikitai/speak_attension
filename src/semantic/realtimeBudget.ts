// Realtime engineering budgets (ADR 0023). These are development targets, not
// guarantees: the product's premise is that a facilitator reads meeting state
// *during* the meeting, so a semantic pipeline that is more accurate but makes
// the UI wait is a regression, not an improvement.
//
// Deliberately a pure module with no timing code of its own: the measuring is
// done by scripts/benchmarkRealtime.ts, which varies with machine and CI load.
// Keeping the thresholds here means the numbers live in one place and can be
// asserted on a recorded measurement without making a flaky timing test.

export const REALTIME_BUDGETS_MS = {
  // final utterance -> the new line is visible in the Timeline
  timelineRender: 50,
  // fast-path semantic processing for the new utterance only
  fastSemantic: 150,
  // provisional Meeting State reflects the new utterance
  provisionalMeetingState: 200,
} as const;

export type RealtimeStage = keyof typeof REALTIME_BUDGETS_MS;

export type StageMeasurement = {
  stage: RealtimeStage;
  // Worst realistic case we hold ourselves to: p95 of per-utterance cost at the
  // given meeting length, not the mean (a facilitator notices the slow ones).
  p95Ms: number;
  utteranceCount: number;
};

export type BudgetVerdict = {
  stage: RealtimeStage;
  budgetMs: number;
  p95Ms: number;
  utteranceCount: number;
  withinBudget: boolean;
  // How much of the budget is consumed. >1 means over budget.
  utilization: number;
};

export function evaluateStage(measurement: StageMeasurement): BudgetVerdict {
  const budgetMs = REALTIME_BUDGETS_MS[measurement.stage];
  return {
    stage: measurement.stage,
    budgetMs,
    p95Ms: measurement.p95Ms,
    utteranceCount: measurement.utteranceCount,
    withinBudget: measurement.p95Ms <= budgetMs,
    utilization: measurement.p95Ms / budgetMs,
  };
}

// The first meeting length at which a stage exceeds its budget, or null when it
// stays inside the budget across every measured length. Used to report "this
// breaks at roughly N utterances" instead of only "it passes today".
export function firstBreachingLength(measurements: StageMeasurement[]): number | null {
  const breaching = measurements
    .filter((measurement) => !evaluateStage(measurement).withinBudget)
    .map((measurement) => measurement.utteranceCount);
  return breaching.length > 0 ? Math.min(...breaching) : null;
}
