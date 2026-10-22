// Runs the corpus through Semantic Core alongside legacy (ADR 0022 §9, ADR 0023).
//
// Phase 1 is a sidecar: this is the only thing that executes the core, it is
// never wired into the live store, and it is what makes the two pipelines
// comparable on identical input.
//
// Core results are emitted in the same shape as the legacy characterization so a
// single evaluator scores both sides -- two scorers would drift, which is the
// class of defect this migration exists to remove.

import type { CaseCharacterization } from "./__corpus__/generateCharacterization.js";
import type { CorpusTestCase } from "./__corpus__/corpusTypes";
import { loadCorpus } from "./__corpus__/loadCorpus";
import { appendUtterance, createEventLog, recentUtterances } from "./rawUtterance";
import { emptyFastPathContext, runFastPath, FAST_PATH_CONTEXT_WINDOW } from "./fastPath";
import { createCanonicalState, entriesOfKind, reduceCanonical } from "./canonicalReducer";
import type { CanonicalMeetingState } from "./types";

export type SidecarCaseResult = {
  caseId: string;
  canonical: CanonicalMeetingState;
  // Same shape as the legacy characterization, so evaluateCorpus scores both.
  asCharacterization: CaseCharacterization;
};

function toCharacterization(testCase: CorpusTestCase, state: CanonicalMeetingState): CaseCharacterization {
  return {
    caseId: testCase.id,
    // The core does not produce the legacy per-utterance analysis; the field
    // exists so the shapes match, and the evaluator does not read it.
    utterances: [],
    confirmedDecisions: entriesOfKind(state, "decision").map((entry) => entry.label),
    nextActions: entriesOfKind(state, "action").map((entry) => ({
      what: entry.label,
      owner: entry.owner ?? null,
      deadline: entry.deadline ?? null,
    })),
    // The core has no notion of a structural gap yet (Phase 3).
    structuralGapsCount: 0,
    unresolvedItemsCount: entriesOfKind(state, "unresolved").length,
  };
}

export function runSidecarCase(testCase: CorpusTestCase): SidecarCaseResult {
  let log = createEventLog();
  let state = createCanonicalState();

  testCase.utterances.forEach((utterance, index) => {
    const appended = appendUtterance(log, {
      id: `${testCase.id}-u${index}`,
      text: utterance.text,
      createdAt: 1_000 + index,
      provider: "replay",
      speaker: utterance.speaker,
    });
    log = appended.log;

    const context = {
      ...emptyFastPathContext(),
      // The window is applied here, at the boundary: the fast path itself is
      // never handed the whole meeting.
      recentUtterances: recentUtterances(log, FAST_PATH_CONTEXT_WINDOW),
    };
    const { assertions } = runFastPath({ utterance: appended.utterance, context });
    state = reduceCanonical(state, {
      kind: "units_asserted",
      at: appended.utterance.createdAt,
      utterance: appended.utterance,
      assertions,
    }).state;
  });

  return { caseId: testCase.id, canonical: state, asCharacterization: toCharacterization(testCase, state) };
}

export function runSidecar(corpus: CorpusTestCase[] = loadCorpus()): SidecarCaseResult[] {
  return corpus.map(runSidecarCase);
}

export function sidecarCharacterizations(corpus: CorpusTestCase[] = loadCorpus()): CaseCharacterization[] {
  return runSidecar(corpus).map((result) => result.asCharacterization);
}
