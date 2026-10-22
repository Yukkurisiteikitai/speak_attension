import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { promoteRelationBasis, promoteUnit, PROMOTION_POLICY_VERSION, type PromotionCandidate } from "./promotionPolicy";
import type { SemanticAxes } from "./types";

const axes = (overrides: Partial<SemanticAxes>): SemanticAxes => ({
  scope: "subject_matter",
  role: "other",
  act: "other",
  commitment: "none",
  epistemic: "explicit",
  provenance: "rule",
  ...overrides,
});

const candidate = (text: string, overrides: Partial<SemanticAxes>, humanConfirmed = false): PromotionCandidate => ({
  unit: { id: "unit-1", utteranceId: "u1", span: { start: 0, end: text.length }, axes: axes(overrides) },
  text,
  utteranceId: "u1",
  assertionId: "a1",
  humanConfirmed,
});

// A unit that would otherwise pass the decision gate, so each invariant test
// changes exactly one thing and shows that one thing is what blocks promotion.
const decidable = { role: "decision" as const, act: "decide" as const, commitment: "decided" as const };

describe("promotion invariants (ADR 0022 §6)", () => {
  it("I1: option != proposal — an enumerated option never becomes a proposal", () => {
    const result = promoteUnit(candidate("方法としてA、B、Cがあります", { role: "option", act: "enumerate", commitment: "mentioned" }));
    expect(result.kind).toBe("option");
    expect(result.kind).not.toBe("proposal");
  });

  it("I2: proposal != decision — a weak commitment never reaches decisions", () => {
    for (const commitment of ["mentioned", "considered", "proposed"] as const) {
      const result = promoteUnit(candidate("対戦ゲーム形式で進めましょう", { ...decidable, commitment }));
      expect(result.kind).not.toBe("decision");
    }
  });

  it("I3: proposal != action — a proposal never becomes an action", () => {
    const result = promoteUnit(candidate("鈴木さんが金曜日までに作成します", {
      role: "proposal", act: "commit", commitment: "committed",
    }));
    expect(result.kind).not.toBe("action");
  });

  it("I4: agenda item != action — meeting_process never reaches decisions or actions", () => {
    expect(promoteUnit(candidate("今日は今四半期のロードマップを確定します", { ...decidable, scope: "meeting_process" })).kind).not.toBe("decision");
    expect(promoteUnit(candidate("鈴木さんが金曜日までに作成します", {
      scope: "meeting_process", role: "action", act: "commit", commitment: "committed",
    })).kind).not.toBe("action");
  });

  it("I5: topic != proposal — a topic start never reaches proposals, decisions or actions", () => {
    const result = promoteUnit(candidate("今日はイベント形式について決めます", {
      role: "topic", act: "topic_start", commitment: "none",
    }));
    expect(["proposal", "decision", "action"]).not.toContain(result.kind);
    expect(result.kind).toBe("topic");
  });

  it("I6: machine inference != human-confirmed fact", () => {
    const inferred = promoteUnit(candidate("対戦ゲーム形式を採用します", { ...decidable, epistemic: "inferred" }));
    expect(inferred.basis).not.toBe("human_confirmed");
    expect(inferred.basis).toBe("provisional");
    // ...and a provisional basis cannot reach a confirmed kind.
    expect(inferred.kind).not.toBe("decision");

    const confirmed = promoteUnit(candidate("対戦ゲーム形式を採用します", decidable, true));
    expect(confirmed.basis).toBe("human_confirmed");
  });

  it("I7: system suggestion != decision — the policy cannot read decisionSupport at all", () => {
    // Structural, not behavioural: there is no import to route a DecisionMaterial
    // into promotion, so one cannot become a decision by any code path. Only
    // import statements are inspected -- the prose above deliberately names the
    // module it must not depend on.
    const source = readFileSync(new URL("./promotionPolicy.ts", import.meta.url), "utf8");
    const importedFrom = [...source.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((match) => match[1]);
    expect(importedFrom).not.toContain("./decisionSupport");
    expect(importedFrom.some((specifier) => /decisionSupport/i.test(specifier))).toBe(false);
    expect(importedFrom).toEqual(["./types", "./parseAxes"]);
  });

  it("I8: ambiguous input goes no further than unresolved", () => {
    const result = promoteUnit(candidate("それで進めましょう", {
      role: "proposal", act: "suggest", commitment: "proposed", epistemic: "ambiguous",
    }));
    expect(result.kind).toBe("unresolved");
  });

  it("I9: deferred != decided", () => {
    const result = promoteUnit(candidate("ランキング機能については、保留にしておきましょう", {
      role: "option", act: "defer", commitment: "deferred",
    }));
    expect(result.kind).toBe("deferred");
    expect(["decision", "action"]).not.toContain(result.kind);
  });

  it("I10: report != decision", () => {
    const result = promoteUnit(candidate("パフォーマンステストは本日中に完了します", {
      act: "report", role: "action", commitment: "decided",
    }));
    expect(result.kind).not.toBe("decision");
  });

  it("I11: commitment is independent of role — role alone never promotes", () => {
    const result = promoteUnit(candidate("対戦ゲーム形式の話です", { role: "decision", act: "report", commitment: "mentioned" }));
    expect(result.kind).not.toBe("decision");
  });

  it("I12: proximity never confirms a relation", () => {
    expect(promoteRelationBasis({ basis: "proximity", epistemic: "explicit" })).toBe("provisional");
    expect(promoteRelationBasis({ basis: "explicit_marker", epistemic: "explicit" })).toBe("rule_explicit");
    expect(promoteRelationBasis({ basis: "human", epistemic: "ambiguous" })).toBe("human_confirmed");
  });

  it("I13: no double promotion — one unit yields exactly one kind", () => {
    // The legacy graph counted 「鈴木さんが…作成します」 as a decision AND an
    // action. A single outcome makes that unrepresentable.
    const result = promoteUnit(candidate("鈴木さんがプロトタイプを来週金曜日までに作成します", {
      role: "action", act: "commit", commitment: "committed",
    }));
    expect(result.kind).toBe("action");
    expect(Object.keys({ [result.kind]: true })).toHaveLength(1);
  });

  it("I14: nothing is discarded — an unmatched unit becomes unresolved", () => {
    const result = promoteUnit(candidate("えーっとその辺はまたあとで", { role: "other", act: "other", commitment: "none" }));
    expect(result.kind).toBe("unresolved");
    expect(result.reason).toContain("no gate matched");
  });
});

describe("promotion gate details", () => {
  it("does not accept a bare ます ending as an explicit decision marker", () => {
    // The whole point of the gate: this is a progress report.
    const result = promoteUnit(candidate("パフォーマンステストは本日中に完了します", {
      role: "action", act: "commit", commitment: "committed", epistemic: "explicit",
    }));
    expect(result.kind).not.toBe("decision");
  });

  it("downgrades an execution commitment with neither owner nor deadline", () => {
    const result = promoteUnit(candidate("対応します", { role: "action", act: "commit", commitment: "committed" }));
    expect(result.kind).not.toBe("action");
  });

  it("carries owner and deadline onto a promoted action", () => {
    const result = promoteUnit(candidate("鈴木さんがプロトタイプを来週金曜日までに作成します", {
      role: "action", act: "commit", commitment: "committed",
    }));
    expect(result.owner).toBe("鈴木");
    expect(result.deadline).toContain("金曜日");
  });

  it("states a policy version so a promotion can be attributed", () => {
    expect(PROMOTION_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
