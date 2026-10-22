// Resolves the competing claims about one unit (ADR 0022 §5, ADR 0023 §9).
//
// Machine assertions are never deleted and never edited in place; a correction
// is a separate event that wins per axis. That is what makes re-analysis safe:
// replacing every machine assertion cannot erase what a person fixed.
//
// A refinement that disagrees with a correction is reported as a conflict, not
// applied. Nothing here silently overwrites a human decision.

import type { AssertionProvenance, HumanCorrection, SemanticAssertion, SemanticAxes, SemanticUnitId } from "./types";

export type AxisName = keyof SemanticAxes;

export type ResolvedUnit = {
  unitId: SemanticUnitId;
  axes: SemanticAxes;
  // Axes whose value came from a person rather than the parser.
  humanOverriddenAxes: AxisName[];
  // Axes where a machine assertion disagrees with the human value. Surfaced for
  // the UI ("参加者の修正と自動解析が異なります"), never auto-applied.
  conflictingAxes: AxisName[];
  // Which assertion supplied the non-overridden axes.
  baseAssertionId: string | null;
};

const AXIS_NAMES: AxisName[] = ["scope", "role", "act", "commitment", "epistemic", "provenance"];

// Highest confidence wins; a tie goes to the newer assertion. Human-provenance
// assertions outrank every machine one regardless of confidence.
function selectBaseAssertion(assertions: SemanticAssertion[]): SemanticAssertion | null {
  const rank = (provenance: AssertionProvenance) => (provenance === "human" ? 2 : 1);
  return assertions.reduce<SemanticAssertion | null>((best, candidate) => {
    if (!best) return candidate;
    const byProvenance = rank(candidate.unit.axes.provenance) - rank(best.unit.axes.provenance);
    if (byProvenance !== 0) return byProvenance > 0 ? candidate : best;
    if (candidate.confidence !== best.confidence) return candidate.confidence > best.confidence ? candidate : best;
    return candidate.createdAt >= best.createdAt ? candidate : best;
  }, null);
}

function correctionsForUnit(unitId: SemanticUnitId, utteranceId: string, corrections: HumanCorrection[]): HumanCorrection[] {
  return corrections
    .filter((correction) =>
      correction.target.unitId === unitId ||
      // An utterance-level correction applies to its units when no unit was named.
      (correction.target.unitId === undefined && correction.target.utteranceId === utteranceId))
    .sort((left, right) => left.at - right.at);
}

export function resolveUnit(
  unitId: SemanticUnitId,
  assertions: SemanticAssertion[],
  corrections: HumanCorrection[],
): ResolvedUnit | null {
  const forUnit = assertions.filter((assertion) => assertion.unit.id === unitId);
  const base = selectBaseAssertion(forUnit);
  if (!base) return null;

  const applicable = correctionsForUnit(unitId, base.unit.utteranceId, corrections);
  const axes: SemanticAxes = { ...base.unit.axes };
  const humanOverriddenAxes: AxisName[] = [];

  // Later corrections win over earlier ones; axes nobody touched stay machine-derived.
  for (const correction of applicable) {
    for (const axis of AXIS_NAMES) {
      const value = correction.axes[axis];
      if (value === undefined) continue;
      (axes[axis] as string) = value;
      if (!humanOverriddenAxes.includes(axis)) humanOverriddenAxes.push(axis);
    }
  }

  // A human-set axis is authoritative, so any machine assertion that disagrees
  // is a conflict to show, not a value to apply.
  const conflictingAxes = humanOverriddenAxes.filter((axis) =>
    forUnit.some((assertion) => assertion.unit.axes.provenance !== "human" && assertion.unit.axes[axis] !== axes[axis]),
  );

  return { unitId, axes, humanOverriddenAxes, conflictingAxes, baseAssertionId: base.id };
}
