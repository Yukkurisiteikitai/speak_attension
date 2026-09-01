import { createId } from "../../ids";
import type { InterventionCandidate } from "../types";

// Trivial timer logic — build/dogfood second, after the two structural
// (graph-based) triggers. Fires only on a tick (see policyEngine.ts's
// evaluateOnTick), since silence is measured by the absence of a new utterance,
// not by one arriving.
export function detectSilenceTrigger(
  lastUtteranceAtMs: number | null,
  now: number,
  thresholdMs: number,
): InterventionCandidate | null {
  if (lastUtteranceAtMs === null) return null;
  const silenceDurationMs = now - lastUtteranceAtMs;
  if (silenceDurationMs < thresholdMs) return null;

  return {
    id: createId("cand"),
    triggerType: "silence",
    createdAtMs: now,
    // Stable across repeated detections of the same ongoing silence (unlike
    // embedding silenceDurationMs, which would make every tick's reasonCode
    // unique and defeat designHingeStore.ts's dedupeAgainstPending). The
    // specific duration still appears in reasonSummary for display.
    reasonCode: "silence",
    reasonSummary: `${Math.round(silenceDurationMs / 1000)}秒間、発言がありません。`,
    relatedNodeIds: [],
    relatedEdgeIds: [],
    confidence: 0.5,
    form: "question",
  };
}
