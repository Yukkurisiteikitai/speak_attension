import fs from "fs";
import path from "path";
import type { CorpusTestCase } from "./corpusTypes";

const caseIds = [
  "01-topic-start",
  "02-agenda-item",
  "03-context",
  "04-option-enumeration",
  "05-personal-consideration",
  "06-proposal-with-reason",
  "07-support",
  "08-opposition",
  "09-decision-explicit",
  "10-decision-paraphrased",
  "11-action-commitment",
  "12-deferred",
  "13-acknowledgement",
  "14-rhetorical-question",
  "15-multi-meaning",
  "16-reference-unresolved",
  "17-topic-return",
  "18-process-greeting",
  "19-explicitly-undecided",
  "20-agenda-paraphrased",
] as const;

function loadCase(caseId: string): CorpusTestCase {
  const caseDir = path.dirname(new URL(import.meta.url).pathname);
  const casePath = path.join(caseDir, "cases", `${caseId}.json`);
  const content = fs.readFileSync(casePath, "utf8");
  return JSON.parse(content) as CorpusTestCase;
}

export function loadCorpus(): CorpusTestCase[] {
  return caseIds.map(loadCase);
}

export function getCaseIds(): readonly string[] {
  return caseIds;
}
