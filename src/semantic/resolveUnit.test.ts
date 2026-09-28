import { describe, expect, it } from "vitest";
import { resolveUnit } from "./resolveUnit";
import type { HumanCorrection, SemanticAssertion, SemanticAxes } from "./types";

const axes = (overrides: Partial<SemanticAxes> = {}): SemanticAxes => ({
  scope: "subject_matter", role: "other", act: "other",
  commitment: "none", epistemic: "inferred", provenance: "rule", ...overrides,
});

const assertion = (id: string, over: Partial<SemanticAxes>, confidence = 0.5, createdAt = 1): SemanticAssertion => ({
  id,
  unit: { id: "unit-1", utteranceId: "u1", span: { start: 0, end: 5 }, axes: axes(over) },
  confidence,
  producedBy: { engine: "test", version: "1" },
  createdAt,
  supersedes: [],
});

const correction = (over: Partial<SemanticAxes>, at = 10, unitId: string | undefined = "unit-1"): HumanCorrection => ({
  id: `c-${at}`, at, target: { utteranceId: "u1", ...(unitId ? { unitId } : {}) }, axes: over, note: null,
});

describe("resolveUnit", () => {
  it("returns null when nothing has been asserted about the unit", () => {
    expect(resolveUnit("unit-1", [], [])).toBeNull();
  });

  it("prefers the higher-confidence assertion, then the newer one", () => {
    const resolved = resolveUnit("unit-1", [
      assertion("a1", { role: "problem" }, 0.5, 1),
      assertion("a2", { role: "proposal" }, 0.9, 1),
    ], []);
    expect(resolved?.axes.role).toBe("proposal");

    const tie = resolveUnit("unit-1", [
      assertion("a1", { role: "problem" }, 0.9, 1),
      assertion("a2", { role: "proposal" }, 0.9, 5),
    ], []);
    expect(tie?.axes.role).toBe("proposal");
  });

  it("lets a human correction win over a more confident machine assertion", () => {
    const resolved = resolveUnit("unit-1", [assertion("a1", { role: "action" }, 0.99)], [correction({ role: "option" })]);
    expect(resolved?.axes.role).toBe("option");
    expect(resolved?.humanOverriddenAxes).toEqual(["role"]);
  });

  it("only overrides the axes the correction names, leaving the rest machine-derived", () => {
    const resolved = resolveUnit("unit-1", [
      assertion("a1", { role: "action", commitment: "committed", scope: "artifact_content" }),
    ], [correction({ role: "option" })]);
    expect(resolved?.axes.role).toBe("option");
    expect(resolved?.axes.commitment).toBe("committed");
    expect(resolved?.axes.scope).toBe("artifact_content");
  });

  it("keeps the human value when re-analysis replaces every machine assertion", () => {
    const corrections = [correction({ role: "option" })];
    const before = resolveUnit("unit-1", [assertion("a1", { role: "action" })], corrections);
    // A new parser version supersedes the old assertion entirely.
    const after = resolveUnit("unit-1", [assertion("a2", { role: "decision" }, 0.95, 99)], corrections);
    expect(before?.axes.role).toBe("option");
    expect(after?.axes.role).toBe("option");
  });

  it("reports a conflict when a machine assertion disagrees with the human value", () => {
    const resolved = resolveUnit("unit-1", [assertion("a1", { role: "action" })], [correction({ role: "option" })]);
    expect(resolved?.conflictingAxes).toEqual(["role"]);
    // Reported, not applied.
    expect(resolved?.axes.role).toBe("option");
  });

  it("reports no conflict when the machine agrees with the human value", () => {
    const resolved = resolveUnit("unit-1", [assertion("a1", { role: "option" })], [correction({ role: "option" })]);
    expect(resolved?.conflictingAxes).toEqual([]);
  });

  it("applies the later correction when a person changes their mind", () => {
    const resolved = resolveUnit("unit-1", [assertion("a1", { role: "action" })], [
      correction({ role: "option" }, 10),
      correction({ role: "problem" }, 20),
    ]);
    expect(resolved?.axes.role).toBe("problem");
  });

  it("applies an utterance-level correction when no unit is named", () => {
    const resolved = resolveUnit("unit-1", [assertion("a1", { role: "action" })], [correction({ role: "context" }, 10, undefined)]);
    expect(resolved?.axes.role).toBe("context");
  });
});
