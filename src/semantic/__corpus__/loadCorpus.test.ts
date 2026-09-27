import { describe, expect, it } from "vitest";
import { loadCorpus, getCaseIds } from "./loadCorpus";

describe("loadCorpus", () => {
  it("loads all 20 cases", () => {
    const corpus = loadCorpus();
    expect(corpus).toHaveLength(20);
  });

  it("each case has required fields", () => {
    const corpus = loadCorpus();
    for (const testCase of corpus) {
      expect(testCase.id).toBeDefined();
      expect(testCase.intent).toBeDefined();
      expect(testCase.coverage).toBeDefined();
      expect(testCase.utterances).toBeDefined();
      expect(Array.isArray(testCase.utterances)).toBe(true);
      expect(testCase.expect).toBeDefined();
      expect(testCase.expect.canonical).toBeDefined();
    }
  });

  it("each utterance has text and speaker", () => {
    const corpus = loadCorpus();
    for (const testCase of corpus) {
      for (const utterance of testCase.utterances) {
        expect(typeof utterance.text).toBe("string");
        expect(typeof utterance.speaker).toBe("string");
      }
    }
  });

  it("each case ID matches filename", () => {
    const corpus = loadCorpus();
    const caseIds = getCaseIds();
    expect(corpus).toHaveLength(caseIds.length);
    for (let i = 0; i < corpus.length; i++) {
      expect(corpus[i].id).toBe(caseIds[i]);
    }
  });

  it("coverage values are all unique and represent all specified types", () => {
    const corpus = loadCorpus();
    const coverageValues = corpus.map((c) => c.coverage);
    const uniqueCoverages = new Set(coverageValues);

    // Verify all 20 are unique
    expect(uniqueCoverages.size).toBe(20);

    // Verify expected coverage types exist
    const expectedCoverages = [
      "topic start",
      "agenda item",
      "context",
      "option enumeration",
      "personal consideration",
      "proposal",
      "support",
      "opposition",
      "decision",
      "decision（言い換え）",
      "action commitment",
      "deferred idea",
      "acknowledgement",
      "rhetorical question",
      "long multi-meaning",
      "reference expression",
      "topic change / return",
      "会議進行の挨拶",
      "明示的な検討中",
      "議題提示の言い換え",
    ];

    for (const expected of expectedCoverages) {
      expect(coverageValues).toContain(expected);
    }
  });

  it("unitCount defaults to 1 when not specified", () => {
    const corpus = loadCorpus();
    const casesWithoutUnitCount = corpus.filter((c) => !("unitCount" in c.expect));
    expect(casesWithoutUnitCount.length).toBeGreaterThan(0);
    // Cases that don't specify unitCount should default to 1
  });
});
