// The *expected* axes for one unit in a corpus case -- a golden expectation,
// not the runtime unit. The runtime shape lives in src/semantic/types.ts and
// carries span/provenance/epistemic as well; keeping the names distinct stops
// a corpus expectation being mistaken for a parser output.
export type SemanticUnitExpectation = {
  scope?: "meeting_process" | "subject_matter" | "artifact_content" | "unknown";
  role?: "topic" | "agenda_item" | "context" | "problem" | "reason" | "evidence" | "option" | "proposal" | "decision" | "action" | "question" | "acknowledgement" | "other";
  act?: "topic_start" | "enumerate" | "report" | "ask" | "suggest" | "advocate" | "oppose" | "decide" | "commit" | "defer" | "acknowledge" | "other";
  commitment?: "none" | "mentioned" | "considered" | "proposed" | "accepted" | "decided" | "committed" | "deferred" | "rejected";
};

export type CanonicalExpectation = {
  decisions?: number;
  actions?: number;
  proposals?: number;
  deferred?: number;
  questions?: number;
  unresolved?: number;
};

export type TestCaseExpectation = {
  canonical: CanonicalExpectation;
  units?: SemanticUnitExpectation[];
  unitCount?: number;
};

export type CorpusUtterance = {
  text: string;
  speaker: string;
};

export type CorpusTestCase = {
  id: string;
  intent: string;
  coverage: string;
  utterances: CorpusUtterance[];
  expect: TestCaseExpectation;
  notes?: string;
};

// A case that omits `expect.unitCount` means "a single utterance maps to a
// single semantic unit" (the corpus README's stated default), not "unit
// count is unspecified" -- callers must resolve through this function
// rather than reading `expect.unitCount` directly.
export function getExpectedUnitCount(testCase: CorpusTestCase): number {
  return testCase.expect.unitCount ?? 1;
}
