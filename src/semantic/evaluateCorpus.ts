import { loadCorpus } from "./__corpus__/loadCorpus";
import type { CaseCharacterization } from "./__corpus__/generateCharacterization.js";

export type CorpusEvaluation = {
  decisionPrecision: number;
  decisionRecall: number;
  actionPrecision: number;
  actionRecall: number;
  unknownRate: number;
  falsePositives: Array<{ caseId: string; category: "decision" | "action"; label: string }>;
};

export function evaluateCorpus(characterizations: CaseCharacterization[]): CorpusEvaluation {
  const corpus = loadCorpus();
  const falsePositives: Array<{ caseId: string; category: "decision" | "action"; label: string }> = [];

  let correctDecisions = 0;
  let totalPredictedDecisions = 0;
  let totalExpectedDecisions = 0;

  let correctActions = 0;
  let totalPredictedActions = 0;
  let totalExpectedActions = 0;

  let caseCount = 0;

  for (let i = 0; i < corpus.length; i++) {
    const testCase = corpus[i];
    const characterization = characterizations.find((c) => c.caseId === testCase.id);

    if (!characterization) {
      continue;
    }

    caseCount++;

    // Extract expected values
    const expectedDecisions = testCase.expect.canonical.decisions ?? 0;
    const expectedActions = testCase.expect.canonical.actions ?? 0;

    // Extract actual values from characterization
    const actualDecisions = characterization.confirmedDecisions.length;
    const actualActions = characterization.nextActions.length;

    totalExpectedDecisions += expectedDecisions;
    totalPredictedDecisions += actualDecisions;

    totalExpectedActions += expectedActions;
    totalPredictedActions += actualActions;

    // Count correct predictions (true positives)
    if (expectedDecisions > 0 && actualDecisions > 0) {
      correctDecisions += Math.min(expectedDecisions, actualDecisions);
    }

    if (expectedActions > 0 && actualActions > 0) {
      correctActions += Math.min(expectedActions, actualActions);
    }

    // Identify false positives (predicted but not expected)
    if (expectedDecisions === 0 && actualDecisions > 0) {
      for (const decision of characterization.confirmedDecisions) {
        falsePositives.push({
          caseId: testCase.id,
          category: "decision",
          label: decision,
        });
      }
    }

    if (expectedActions === 0 && actualActions > 0) {
      for (const action of characterization.nextActions) {
        falsePositives.push({
          caseId: testCase.id,
          category: "action",
          label: action.what,
        });
      }
    }
  }

  const decisionPrecision =
    totalPredictedDecisions > 0 ? correctDecisions / totalPredictedDecisions : 1;
  const decisionRecall = totalExpectedDecisions > 0 ? correctDecisions / totalExpectedDecisions : 1;
  const actionPrecision = totalPredictedActions > 0 ? correctActions / totalPredictedActions : 1;
  const actionRecall = totalExpectedActions > 0 ? correctActions / totalExpectedActions : 1;
  const unknownRate = caseCount > 0 ? falsePositives.length / caseCount : 0;

  return {
    decisionPrecision,
    decisionRecall,
    actionPrecision,
    actionRecall,
    unknownRate,
    falsePositives,
  };
}
