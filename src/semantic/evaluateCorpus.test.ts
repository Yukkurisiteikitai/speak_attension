import { describe, expect, it } from "vitest";
import { evaluateCorpus } from "./evaluateCorpus";
import type { CorpusTestCase } from "./__corpus__/corpusTypes";
import type { CaseCharacterization } from "./__corpus__/generateCharacterization";

function utterance(text: string) {
  return { text, speaker: "スピーカー" };
}

// A minimal, hand-computed fixture -- not the real corpus -- so the
// expected metrics below can be verified by hand rather than merely
// checked for shape/range.
const fixtureCorpus: CorpusTestCase[] = [
  {
    id: "case-a",
    intent: "expects a decision; actions left unevaluated (omitted)",
    coverage: "fixture-a",
    utterances: [utterance("A")],
    expect: { canonical: { decisions: 1 } },
  },
  {
    id: "case-b",
    intent: "expects nothing; legacy correctly predicts nothing",
    coverage: "fixture-b",
    utterances: [utterance("B")],
    expect: { canonical: { decisions: 0, actions: 0 } },
  },
  {
    id: "case-c",
    intent: "expects an action; legacy also produces an unexpected decision",
    coverage: "fixture-c",
    utterances: [utterance("C1"), utterance("C2")],
    expect: { canonical: { decisions: 0, actions: 1 } },
  },
];

const fixtureCharacterizations: CaseCharacterization[] = [
  {
    caseId: "case-a",
    utterances: [],
    confirmedDecisions: ["A decision"],
    // case-a omits `actions` from its expectation, so this predicted
    // action must be excluded from both action metrics and falsePositives.
    nextActions: [{ what: "an unevaluated action", owner: null, deadline: null }],
    structuralGapsCount: 0,
    unresolvedItemsCount: 0,
  },
  {
    caseId: "case-b",
    utterances: [],
    confirmedDecisions: [],
    nextActions: [],
    structuralGapsCount: 0,
    unresolvedItemsCount: 1,
  },
  {
    caseId: "case-c",
    utterances: [],
    confirmedDecisions: ["bogus decision"],
    nextActions: [{ what: "real action", owner: null, deadline: null }],
    structuralGapsCount: 0,
    unresolvedItemsCount: 0,
  },
];

describe("evaluateCorpus", () => {
  it("computes exact precision/recall/unknownRate and false positives for a hand-verified fixture", () => {
    const evaluation = evaluateCorpus(fixtureCorpus, fixtureCharacterizations);

    // decisions: expected total 1 (case-a), predicted total 2 (case-a:1, case-c:1),
    // correct 1 (case-a matches) -> precision 1/2, recall 1/1
    expect(evaluation.decisionPrecision).toBeCloseTo(0.5);
    expect(evaluation.decisionRecall).toBeCloseTo(1);

    // actions: case-a's action is unevaluated (omitted expectation), so only
    // case-c counts -> expected 1, predicted 1, correct 1 -> precision 1, recall 1
    expect(evaluation.actionPrecision).toBeCloseTo(1);
    expect(evaluation.actionRecall).toBeCloseTo(1);

    // unknownRate = total unresolvedItemsCount / total utterances = 1 / 4
    expect(evaluation.unknownRate).toBeCloseTo(0.25);

    expect(evaluation.falsePositives).toEqual([
      { caseId: "case-c", category: "decision", label: "bogus decision" },
    ]);
  });

  it("throws when a characterization entry is missing for a corpus case", () => {
    const incomplete = fixtureCharacterizations.slice(0, 2);
    expect(() => evaluateCorpus(fixtureCorpus, incomplete)).toThrow(/case-c/);
  });

  it("throws when a characterization entry is duplicated", () => {
    const duplicated = [...fixtureCharacterizations, fixtureCharacterizations[0]];
    expect(() => evaluateCorpus(fixtureCorpus, duplicated)).toThrow(/case-a/);
  });
});
