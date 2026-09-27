export type SemanticUnit = {
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
  units?: SemanticUnit[];
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
