import { createId } from "../../ids";
import { jaccardSimilarity } from "../../graph/textSimilarity";
import type { InterventionCandidate } from "../types";

// Needs the recent-utterance ring buffer (policyEngine.ts's
// PolicyEngineState.recentUtteranceTexts) — build/dogfood third, after
// silenceTrigger.ts. Fires only on a new utterance (see policyEngine.ts's
// evaluateOnUtterance), since stagnation is about what was just said compared
// to what came immediately before it.
export function detectStagnationTrigger(
  recentUtterances: string[],
  windowSize: number,
  similarityThreshold: number,
  now: number,
): InterventionCandidate | null {
  if (recentUtterances.length < windowSize + 1) return null;

  const window = recentUtterances.slice(-(windowSize + 1));
  const latest = window[window.length - 1];
  const previous = window.slice(0, -1);

  const allSimilar = previous.every((text) => jaccardSimilarity(latest, text) >= similarityThreshold);
  if (!allSimilar) return null;

  return {
    id: createId("cand"),
    triggerType: "stagnation",
    createdAtMs: now,
    reasonCode: `stagnation:window=${windowSize}`,
    reasonSummary: `直近${windowSize}件の発言が似た内容の繰り返しです。`,
    relatedNodeIds: [],
    relatedEdgeIds: [],
    confidence: 0.5,
    form: "question",
  };
}
