import fs from "fs";
import path from "path";
import { generateCharacterization } from "../src/semantic/__corpus__/generateCharacterization";
import { evaluateCorpus } from "../src/semantic/evaluateCorpus";

const characterizations = generateCharacterization();
const evaluation = evaluateCorpus(characterizations);

// Print table format
console.log("\n=== Semantic Corpus Evaluation ===\n");
console.log("Decision Metrics:");
console.log(`  Precision: ${(evaluation.decisionPrecision * 100).toFixed(1)}%`);
console.log(`  Recall:    ${(evaluation.decisionRecall * 100).toFixed(1)}%`);

console.log("\nAction Metrics:");
console.log(`  Precision: ${(evaluation.actionPrecision * 100).toFixed(1)}%`);
console.log(`  Recall:    ${(evaluation.actionRecall * 100).toFixed(1)}%`);

console.log(`\nUnknown Rate: ${(evaluation.unknownRate * 100).toFixed(1)}%`);

if (evaluation.falsePositives.length > 0) {
  console.log("\nFalse Positives:");
  for (const fp of evaluation.falsePositives) {
    console.log(`  [${fp.caseId}] ${fp.category}: "${fp.label}"`);
  }
} else {
  console.log("\nNo false positives detected.");
}

// Output as JSON for machine readability
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const resultPath = path.join(logsDir, "semantic-eval-result.json");
fs.writeFileSync(resultPath, JSON.stringify(evaluation, null, 2));

console.log(`\nDetailed results saved to: ${resultPath}`);
