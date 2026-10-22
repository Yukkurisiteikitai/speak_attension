import { describe, expect, it } from "vitest";
import { runSidecar, runSidecarCase, sidecarCharacterizations } from "./runSidecar";
import { loadCorpus } from "./__corpus__/loadCorpus";
import { generateCharacterization } from "./__corpus__/generateCharacterization";
import { evaluateCorpus } from "./evaluateCorpus";
import { entriesOfKind } from "./canonicalReducer";

const corpus = loadCorpus();
const byId = (id: string) => corpus.find((testCase) => testCase.id === id)!;

describe("runSidecar", () => {
  it("runs every corpus case without throwing", () => {
    expect(runSidecar(corpus)).toHaveLength(corpus.length);
  });

  it("produces no decision or action false positives (Phase 1 acceptance)", () => {
    const evaluation = evaluateCorpus(corpus, sidecarCharacterizations(corpus));
    expect(evaluation.falsePositives).toEqual([]);
  });

  it("does not regress decision precision against legacy", () => {
    const legacy = evaluateCorpus(corpus, generateCharacterization());
    const core = evaluateCorpus(corpus, sidecarCharacterizations(corpus));
    expect(core.decisionPrecision).toBeGreaterThanOrEqual(legacy.decisionPrecision);
    expect(core.actionPrecision).toBeGreaterThanOrEqual(legacy.actionPrecision);
  });
});

describe("runSidecar: the cases legacy gets wrong", () => {
  it("does not promote a meeting greeting to a decision or action", () => {
    const state = runSidecarCase(byId("18-process-greeting")).canonical;
    expect(entriesOfKind(state, "decision")).toEqual([]);
    expect(entriesOfKind(state, "action")).toEqual([]);
  });

  it("does not promote an explicit 「検討中」 to a decision", () => {
    const state = runSidecarCase(byId("19-explicitly-undecided")).canonical;
    expect(entriesOfKind(state, "decision")).toEqual([]);
  });

  it("does not promote a paraphrased agenda item to a decision", () => {
    // docs/STATE.md promises this; legacy's literal-form regex misses 「確定します」.
    const state = runSidecarCase(byId("20-agenda-paraphrased")).canonical;
    expect(entriesOfKind(state, "decision")).toEqual([]);
    expect(entriesOfKind(state, "action")).toEqual([]);
  });

  it("catches the paraphrased decision legacy misses", () => {
    const state = runSidecarCase(byId("10-decision-paraphrased")).canonical;
    expect(entriesOfKind(state, "decision")).toHaveLength(1);
  });

  it("records a deferred idea instead of dropping it", () => {
    const state = runSidecarCase(byId("12-deferred")).canonical;
    expect(entriesOfKind(state, "deferred")).toHaveLength(1);
    expect(entriesOfKind(state, "decision")).toEqual([]);
  });

  it("counts an action commitment once, not as both a decision and an action", () => {
    const state = runSidecarCase(byId("11-action-commitment")).canonical;
    expect(entriesOfKind(state, "action")).toHaveLength(1);
    expect(entriesOfKind(state, "decision")).toEqual([]);
  });

  it("keeps a personal consideration out of actions", () => {
    const state = runSidecarCase(byId("05-personal-consideration")).canonical;
    expect(entriesOfKind(state, "action")).toEqual([]);
    expect(entriesOfKind(state, "decision")).toEqual([]);
  });

  it("splits a reason from its proposal and promotes only the proposal", () => {
    const state = runSidecarCase(byId("06-proposal-with-reason")).canonical;
    expect(entriesOfKind(state, "proposal")).toHaveLength(1);
    expect(entriesOfKind(state, "decision")).toEqual([]);
  });

  it("leaves an unresolved pronoun unpromoted rather than guessing", () => {
    const state = runSidecarCase(byId("16-reference-unresolved")).canonical;
    expect(entriesOfKind(state, "decision")).toEqual([]);
    expect(entriesOfKind(state, "unresolved").length).toBeGreaterThan(0);
  });
});
