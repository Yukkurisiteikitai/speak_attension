import { readFileSync } from "node:fs";
import { DEFAULT_POLICY_PARAMETERS, type PolicyParameters } from "../policy/defaultParameters";
import type { DesignHingeSessionExport } from "../events/exportEvents";
import { replaySessionThroughPolicy } from "./shadowMode";

// Dev script, not test-covered — same execution style as server/index.ts
// (run via `tsx`). No worker/queue: this is a script a solo dev runs by hand
// against a session JSON exported from designHingeStore.exportSession().
//
// Usage: tsx design-hinge/replay/runShadowMode.ts <exported-session.json> [alt-params.json]

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function main() {
  const [, , exportPath, paramsPath] = process.argv;
  if (!exportPath) {
    console.error("Usage: tsx design-hinge/replay/runShadowMode.ts <exported-session.json> [alt-params.json]");
    process.exitCode = 1;
    return;
  }

  const sessionExport = readJsonFile<DesignHingeSessionExport>(exportPath);
  const policyParameters: PolicyParameters = paramsPath
    ? { ...DEFAULT_POLICY_PARAMETERS, ...readJsonFile<Partial<PolicyParameters>>(paramsPath) }
    : DEFAULT_POLICY_PARAMETERS;
  const policyVersion = paramsPath ? `${sessionExport.policyVersion}+shadow` : sessionExport.policyVersion;

  const report = replaySessionThroughPolicy({ export: sessionExport, policyParameters, policyVersion });

  console.log(`Session: ${report.sessionId}`);
  console.log(`Original policy: ${report.originalPolicyVersion}`);
  console.log(`Replayed policy: ${report.replayedPolicyVersion}`);
  console.log(`Over-trigger rate: ${(report.overTriggerRate * 100).toFixed(1)}%`);
  console.log(`Under-trigger rate: ${(report.underTriggerRate * 100).toFixed(1)}%`);
  console.log(report.summary);
  console.log("");
  console.log("Per-utterance decisions:");
  for (const decision of report.decisions) {
    const mark = decision.agreesWithActual ? "  " : "!!";
    console.log(`${mark} [${decision.atMs}] wouldTrigger=${decision.wouldTrigger} actual=${decision.actualOutcome} :: ${decision.utteranceText}`);
  }
}

main();
