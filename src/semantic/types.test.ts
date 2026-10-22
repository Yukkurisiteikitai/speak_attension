import { describe, expect, it } from "vitest";
import { sliceUnitText, type Commitment, type DiscourseAct, type PromotionBasis, type Scope, type SemanticAxes } from "./types";

// The axis value sets are a contract shared with the corpus expectations and the
// promotion policy. Pinning them here means widening an axis is a deliberate,
// visible change rather than something that slips in with a parser tweak.
describe("axis value sets (ADR 0022 §3, ADR 0023 §6)", () => {
  it("scope has exactly the four documented layers", () => {
    const all: Scope[] = ["meeting_process", "subject_matter", "artifact_content", "unknown"];
    expect(new Set(all).size).toBe(4);
  });

  it("discourse acts include oppose and defer", () => {
    // Support/opposition and deferral were the readings the single-label model
    // could not express at all.
    const acts: DiscourseAct[] = ["oppose", "defer"];
    expect(acts).toHaveLength(2);
  });

  it("commitment includes deferred and keeps accepted distinct from decided", () => {
    const accepted: Commitment = "accepted";
    const decided: Commitment = "decided";
    const deferred: Commitment = "deferred";
    expect(new Set([accepted, decided, deferred]).size).toBe(3);
  });

  it("promotion basis has exactly three values, with rule_inferred merged into provisional", () => {
    const all: PromotionBasis[] = ["provisional", "rule_explicit", "human_confirmed"];
    expect(new Set(all).size).toBe(3);
    // @ts-expect-error rule_inferred was merged into "provisional" (ADR 0023 §6)
    const removed: PromotionBasis = "rule_inferred";
    expect(removed).toBe("rule_inferred");
  });

  it("the six axes are all present and independently typed", () => {
    const axes: SemanticAxes = {
      scope: "subject_matter",
      role: "decision",
      act: "report",
      // A decision role with a weak commitment must be representable: if the
      // type forced them to agree, invariant I11 would be untestable.
      commitment: "mentioned",
      epistemic: "inferred",
      provenance: "rule",
    };
    expect(Object.keys(axes)).toHaveLength(6);
  });
});

describe("sliceUnitText", () => {
  it("derives the unit text from the raw utterance instead of a stored copy", () => {
    const utterance = {
      id: "u1", seq: 1, text: "スマホで集客しやすいので、対戦ゲーム形式で進めましょう",
      createdAt: 1, speaker: null, provider: "manual" as const,
    };
    const unit = { id: "u1#u1", utteranceId: "u1", span: { start: 13, end: 27 }, axes: {} as SemanticAxes };
    expect(sliceUnitText(utterance, unit)).toBe("対戦ゲーム形式で進めましょう");
  });
});
