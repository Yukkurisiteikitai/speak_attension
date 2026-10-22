import { describe, expect, it } from "vitest";
import { generateCharacterization } from "../generateCharacterization";
import legacy from "./legacy.snap.json";

describe("legacy characterization snapshot", () => {
  it("current legacy implementation matches snapshot", () => {
    const current = generateCharacterization();
    expect(current).toEqual(legacy);
  });

  it("snapshot has 20 cases", () => {
    expect(legacy).toHaveLength(20);
  });

  it("each snapshot entry has required fields", () => {
    for (const entry of legacy) {
      expect(entry.caseId).toBeDefined();
      expect(Array.isArray(entry.utterances)).toBe(true);
      expect(typeof entry.structuralGapsCount).toBe("number");
      expect(typeof entry.unresolvedItemsCount).toBe("number");
    }
  });
});
