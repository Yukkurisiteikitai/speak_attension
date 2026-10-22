import fs from "fs";
import path from "path";
import { loadCorpus } from "../src/semantic/__corpus__/loadCorpus";
import { generateCharacterization } from "../src/semantic/__corpus__/generateCharacterization";
import { evaluateCorpus } from "../src/semantic/evaluateCorpus";
import { sidecarCharacterizations } from "../src/semantic/runSidecar";

const corpus = loadCorpus();
const legacy = evaluateCorpus(corpus, generateCharacterization());
// Phase 1 runs Semantic Core as a sidecar on the same corpus, so both pipelines
// are scored by the same evaluator -- two scorers would drift apart.
const core = evaluateCorpus(corpus, sidecarCharacterizations(corpus));

const percent = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(7);

console.log("\n=== Semantic Corpus Evaluation ===\n");
console.log("metric                legacy      core");
console.log("--------------------+---------+---------");
console.log(`decision precision  | ${percent(legacy.decisionPrecision)} | ${percent(core.decisionPrecision)}`);
console.log(`decision recall     | ${percent(legacy.decisionRecall)} | ${percent(core.decisionRecall)}`);
console.log(`action precision    | ${percent(legacy.actionPrecision)} | ${percent(core.actionPrecision)}`);
console.log(`action recall       | ${percent(legacy.actionRecall)} | ${percent(core.actionRecall)}`);
console.log(`unknown rate        | ${percent(legacy.unknownRate)} | ${percent(core.unknownRate)}`);
console.log(`false positives     | ${String(legacy.falsePositives.length).padStart(7)} | ${String(core.falsePositives.length).padStart(7)}`);

for (const [label, evaluation] of [["legacy", legacy], ["core", core]] as const) {
  if (evaluation.falsePositives.length === 0) {
    console.log(`\n${label}: no false positives detected.`);
    continue;
  }
  console.log(`\n${label} false positives:`);
  for (const falsePositive of evaluation.falsePositives) {
    console.log(`  [${falsePositive.caseId}] ${falsePositive.category}: "${falsePositive.label}"`);
  }
}

// Output as JSON for machine readability
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const resultPath = path.join(logsDir, "semantic-eval-result.json");
fs.writeFileSync(resultPath, JSON.stringify({ legacy, core }, null, 2));

console.log(`\nDetailed results saved to: ${resultPath}`);
