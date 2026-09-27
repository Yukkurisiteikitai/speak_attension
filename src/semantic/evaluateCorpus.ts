import type { CorpusTestCase } from "./__corpus__/corpusTypes";
import type { CaseCharacterization } from "./__corpus__/generateCharacterization.js";

export type CorpusEvaluation = {
  decisionPrecision: number;
  decisionRecall: number;
  actionPrecision: number;
  actionRecall: number;
  // Fraction of utterances across the corpus that legacy leaves in
  // unresolvedItems -- the only "I don't know" signal legacy records.
  // This is not a false-positive rate.
  unknownRate: number;
  falsePositives: Array<{ caseId: string; category: "decision" | "action"; label: string }>;
};

function indexCharacterizations(
  corpus: CorpusTestCase[],
  characterizations: CaseCharacterization[],
): Map<string, CaseCharacterization> {
  const byId = new Map<string, CaseCharacterization>();
  for (const characterization of characterizations) {
    if (byId.has(characterization.caseId)) {
      throw new Error(`Duplicate characterization entry for case "${characterization.caseId}"`);
    }
    byId.set(characterization.caseId, characterization);
  }

  const missing = corpus.filter((testCase) => !byId.has(testCase.id)).map((testCase) => testCase.id);
  if (missing.length > 0) {
    throw new Error(`Missing characterization entries for case(s): ${missing.join(", ")}`);
  }

  return byId;
}

export function evaluateCorpus(
  corpus: CorpusTestCase[],
  characterizations: CaseCharacterization[],
): CorpusEvaluation {
  const characterizationById = indexCharacterizations(corpus, characterizations);
  const falsePositives: Array<{ caseId: string; category: "decision" | "action"; label: string }> = [];

  let correctDecisions = 0;
  let totalPredictedDecisions = 0;
  let totalExpectedDecisions = 0;

  let correctActions = 0;
  let totalPredictedActions = 0;
  let totalExpectedActions = 0;

  let totalUnresolvedItems = 0;
  let totalUtterances = 0;

  for (const testCase of corpus) {
    const characterization = characterizationById.get(testCase.id)!;

    totalUnresolvedItems += characterization.unresolvedItemsCount;
    totalUtterances += testCase.utterances.length;

    const actualDecisions = characterization.confirmedDecisions.length;
    const actualActions = characterization.nextActions.length;

    // A canonical field the case omits is "not evaluated" (per the corpus
    // README): it must not be treated as an expected zero, or every
    // omitted field silently turns legacy's real output into a false
    // positive.
    const expectedDecisions = testCase.expect.canonical.decisions;
    const expectedActions = testCase.expect.canonical.actions;

    if (expectedDecisions !== undefined) {
      totalExpectedDecisions += expectedDecisions;
      totalPredictedDecisions += actualDecisions;

      if (expectedDecisions > 0 && actualDecisions > 0) {
        correctDecisions += Math.min(expectedDecisions, actualDecisions);
      }

      if (expectedDecisions === 0 && actualDecisions > 0) {
        for (const decision of characterization.confirmedDecisions) {
          falsePositives.push({ caseId: testCase.id, category: "decision", label: decision });
        }
      }
    }

    if (expectedActions !== undefined) {
      totalExpectedActions += expectedActions;
      totalPredictedActions += actualActions;

      if (expectedActions > 0 && actualActions > 0) {
        correctActions += Math.min(expectedActions, actualActions);
      }

      if (expectedActions === 0 && actualActions > 0) {
        for (const action of characterization.nextActions) {
          falsePositives.push({ caseId: testCase.id, category: "action", label: action.what });
        }
      }
    }
  }

  const decisionPrecision =
    totalPredictedDecisions > 0 ? correctDecisions / totalPredictedDecisions : 1;
  const decisionRecall = totalExpectedDecisions > 0 ? correctDecisions / totalExpectedDecisions : 1;
  const actionPrecision = totalPredictedActions > 0 ? correctActions / totalPredictedActions : 1;
  const actionRecall = totalExpectedActions > 0 ? correctActions / totalExpectedActions : 1;
  const unknownRate = totalUtterances > 0 ? totalUnresolvedItems / totalUtterances : 0;

  return {
    decisionPrecision,
    decisionRecall,
    actionPrecision,
    actionRecall,
    unknownRate,
    falsePositives,
  };
}
