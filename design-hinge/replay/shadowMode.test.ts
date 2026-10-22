import { describe, expect, it } from "vitest";
import { createDesignHingeStore } from "../store/designHingeStore";
import { DEFAULT_POLICY_PARAMETERS } from "../policy/defaultParameters";
import { replaySessionThroughPolicy } from "./shadowMode";

describe("replaySessionThroughPolicy", () => {
  it("returns an empty, non-NaN report for a session with no utterances", () => {
    const store = createDesignHingeStore();
    const report = replaySessionThroughPolicy({
      export: store.exportSession(),
      policyParameters: DEFAULT_POLICY_PARAMETERS,
      policyVersion: "policy_shadow_test",
    });

    expect(report.decisions).toEqual([]);
    expect(report.overTriggerRate).toBe(0);
    expect(report.underTriggerRate).toBe(0);
    expect(report.summary).toContain("比較できません");
  });

  it("replaying with the same parameters mostly agrees with what the original policy decided", () => {
    const store = createDesignHingeStore();
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0 });
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    store.ingestUtterance("説得には証拠が必要", "manual");
    store.ingestUtterance("今日はいい天気ですね", "manual");

    const sessionExport = store.exportSession();
    const report = replaySessionThroughPolicy({
      export: sessionExport,
      policyParameters: { ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0 },
      policyVersion: sessionExport.policyVersion,
    });

    expect(report.decisions).toHaveLength(3);
    expect(report.decisions.every((d) => d.agreesWithActual)).toBe(true);
    expect(report.overTriggerRate).toBe(0);
    expect(report.underTriggerRate).toBe(0);
  });

  it("a stricter causal confidence threshold produces an under-trigger rate against a looser original policy", () => {
    const store = createDesignHingeStore();
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0.9 }); // flags the 0.6-confidence edge
    store.ingestUtterance("証拠がなければ告発できない", "manual");

    const sessionExport = store.exportSession();
    const report = replaySessionThroughPolicy({
      export: sessionExport,
      // Replaying with a threshold below the edge's own confidence (0.6) never flags it.
      policyParameters: { ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0.1 },
      policyVersion: sessionExport.policyVersion,
    });

    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0].wouldTrigger).toBe(false);
    expect(report.decisions[0].actualOutcome).not.toBe("not_applicable");
    expect(report.underTriggerRate).toBe(1);
    expect(report.overTriggerRate).toBe(0);
  });

  it("a looser threshold than the original produces an over-trigger rate", () => {
    const store = createDesignHingeStore();
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0.1 }); // never flags the 0.6-confidence edge
    store.ingestUtterance("証拠がなければ告発できない", "manual");

    const sessionExport = store.exportSession();
    const report = replaySessionThroughPolicy({
      export: sessionExport,
      // Replaying with a threshold above the edge's confidence now flags it.
      policyParameters: { ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0.9 },
      policyVersion: sessionExport.policyVersion,
    });

    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0].wouldTrigger).toBe(true);
    expect(report.decisions[0].actualOutcome).toBe("not_applicable");
    expect(report.overTriggerRate).toBe(1);
    expect(report.underTriggerRate).toBe(0);
  });
});
