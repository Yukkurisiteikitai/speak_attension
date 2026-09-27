import { describe, expect, it } from "vitest";
import { evaluateCorpus } from "./evaluateCorpus";
import legacy from "./__corpus__/characterization/legacy.snap.json";

describe("evaluateCorpus", () => {
  it("evaluates corpus and returns metrics", () => {
    const evaluation = evaluateCorpus(legacy as any);

    expect(evaluation).toHaveProperty("decisionPrecision");
    expect(evaluation).toHaveProperty("decisionRecall");
    expect(evaluation).toHaveProperty("actionPrecision");
    expect(evaluation).toHaveProperty("actionRecall");
    expect(evaluation).toHaveProperty("unknownRate");
    expect(evaluation).toHaveProperty("falsePositives");
    expect(Array.isArray(evaluation.falsePositives)).toBe(true);
  });

  it("precision and recall are between 0 and 1", () => {
    const evaluation = evaluateCorpus(legacy as any);

    expect(evaluation.decisionPrecision).toBeGreaterThanOrEqual(0);
    expect(evaluation.decisionPrecision).toBeLessThanOrEqual(1);
    expect(evaluation.decisionRecall).toBeGreaterThanOrEqual(0);
    expect(evaluation.decisionRecall).toBeLessThanOrEqual(1);
    expect(evaluation.actionPrecision).toBeGreaterThanOrEqual(0);
    expect(evaluation.actionPrecision).toBeLessThanOrEqual(1);
    expect(evaluation.actionRecall).toBeGreaterThanOrEqual(0);
    expect(evaluation.actionRecall).toBeLessThanOrEqual(1);
  });

  it("identifies false positives", () => {
    const evaluation = evaluateCorpus(legacy as any);

    // Should have some false positives based on the expected behavior
    expect(evaluation.falsePositives.length).toBeGreaterThan(0);

    // Each false positive should have required fields
    for (const fp of evaluation.falsePositives) {
      expect(fp.caseId).toBeDefined();
      expect(["decision", "action"]).toContain(fp.category);
      expect(fp.label).toBeDefined();
    }
  });
});
