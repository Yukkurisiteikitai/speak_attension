// Phase 3 measurement (design doc §6.2): per-case diff of decisions and actions
// between the legacy pipeline and Semantic Core, saved for the PR.
//
// This is a report, not a test. It exits 0 whatever the numbers are; the
// acceptance rule (no new false positive in core) is printed for the reviewer.

import fs from "fs";
import path from "path";
import { loadCorpus } from "../src/semantic/__corpus__/loadCorpus";
import { generateCharacterization } from "../src/semantic/__corpus__/generateCharacterization";
import { sidecarCharacterizations } from "../src/semantic/runSidecar";
import type { CorpusTestCase } from "../src/semantic/__corpus__/corpusTypes";
import type { CaseCharacterization } from "../src/semantic/__corpus__/generateCharacterization";

type SideDiff = { onlyLegacy: string[]; onlyCore: string[]; both: string[] };

function diffLabels(legacy: string[], core: string[]): SideDiff {
  const legacySet = new Set(legacy);
  const coreSet = new Set(core);
  return {
    onlyLegacy: [...legacySet].filter((label) => !coreSet.has(label)),
    onlyCore: [...coreSet].filter((label) => !legacySet.has(label)),
    both: [...legacySet].filter((label) => coreSet.has(label)),
  };
}

// A core decision is a false positive when the corpus expects zero decisions.
// A "new" false positive is one core makes that legacy did not make.
function isFalsePositive(testCase: CorpusTestCase, kind: "decisions" | "actions", count: number): boolean {
  const expected = testCase.expect.canonical[kind];
  return expected === 0 && count > 0;
}

const corpus = loadCorpus();
const legacyById = new Map<string, CaseCharacterization>(
  generateCharacterization().map((item) => [item.caseId, item]),
);
const coreById = new Map<string, CaseCharacterization>(
  sidecarCharacterizations(corpus).map((item) => [item.caseId, item]),
);

let legacyFalsePositives = 0;
let coreFalsePositives = 0;
let newFalsePositives = 0;

const cases = corpus.map((testCase) => {
  const legacy = legacyById.get(testCase.id);
  const core = coreById.get(testCase.id);
  if (!legacy || !core) throw new Error(`missing characterization for ${testCase.id}`);

  const legacyDecisions = legacy.confirmedDecisions;
  const coreDecisions = core.confirmedDecisions;
  const legacyActions = legacy.nextActions.map((action) => action.what);
  const coreActions = core.nextActions.map((action) => action.what);

  const legacyDecisionFp = isFalsePositive(testCase, "decisions", legacyDecisions.length);
  const coreDecisionFp = isFalsePositive(testCase, "decisions", coreDecisions.length);
  const legacyActionFp = isFalsePositive(testCase, "actions", legacyActions.length);
  const coreActionFp = isFalsePositive(testCase, "actions", coreActions.length);

  legacyFalsePositives += Number(legacyDecisionFp) + Number(legacyActionFp);
  coreFalsePositives += Number(coreDecisionFp) + Number(coreActionFp);
  newFalsePositives += Number(coreDecisionFp && !legacyDecisionFp) + Number(coreActionFp && !legacyActionFp);

  return {
    caseId: testCase.id,
    expected: testCase.expect.canonical,
    decisions: diffLabels(legacyDecisions, coreDecisions),
    actions: diffLabels(legacyActions, coreActions),
    falsePositive: { legacy: { decisions: legacyDecisionFp, actions: legacyActionFp }, core: { decisions: coreDecisionFp, actions: coreActionFp } },
  };
});

const report = {
  phase: 3,
  acceptance: "core false positives must not exceed legacy's, and must be fewer overall (design doc §6.2)",
  summary: {
    legacyFalsePositives,
    coreFalsePositives,
    newFalsePositives,
    passesAcceptance: newFalsePositives === 0 && coreFalsePositives <= legacyFalsePositives,
  },
  cases,
};

const outputPath = path.join(process.cwd(), "src/semantic/__corpus__/characterization/phase3-diff.json");
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");

console.log("\n=== Phase 3 diff: legacy vs core ===\n");
console.log(`legacy false positives: ${legacyFalsePositives}`);
console.log(`core false positives:   ${coreFalsePositives}`);
console.log(`new false positives (core only): ${newFalsePositives}`);
console.log(`acceptance: ${report.summary.passesAcceptance ? "PASS" : "FAIL"}`);
console.log(`\nwritten: ${outputPath}`);
