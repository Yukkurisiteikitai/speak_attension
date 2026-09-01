import { createId } from "../ids";
import type { HingeGraph } from "../graph/types";
import type { PolicyParameters } from "./defaultParameters";
import type { InterventionCandidate } from "./types";
import { detectContradictionTrigger } from "./triggers/contradictionTrigger";
import { detectGraphGapTrigger } from "./triggers/graphGapTrigger";
import { detectSilenceTrigger } from "./triggers/silenceTrigger";
import { detectStagnationTrigger } from "./triggers/stagnationTrigger";

const RECENT_UTTERANCE_BUFFER_SIZE = 20;

export type PolicyEngineState = {
  policyVersion: string;
  lastInterventionAtMs: number | null;
  lastUtteranceAtMs: number | null;
  recentUtteranceTexts: string[];
  eligibilityLog: InterventionCandidate[];
};

export function createInitialPolicyEngineState(policyVersion: string): PolicyEngineState {
  return {
    policyVersion,
    lastInterventionAtMs: null,
    lastUtteranceAtMs: null,
    recentUtteranceTexts: [],
    eligibilityLog: [],
  };
}

function withinCooldown(state: PolicyEngineState, params: PolicyParameters, now: number): boolean {
  if (state.lastInterventionAtMs === null) return false;
  return now - state.lastInterventionAtMs < params.minInterventionIntervalMs;
}

// Triggers that only depend on graph structure, not on utterance timing —
// safe to evaluate on either an utterance or a tick. Silence/Stagnation
// (timer- and buffer-based) are wired in separately once they exist
// (see triggers/silenceTrigger.ts, triggers/stagnationTrigger.ts).
function collectStructuralCandidates(graph: HingeGraph, params: PolicyParameters, now: number): InterventionCandidate[] {
  return [
    ...detectGraphGapTrigger(graph, params.isolatedNodeThreshold, params.causalConfidenceThreshold, now),
    ...detectContradictionTrigger(graph, params.causalConfidenceThreshold, now),
  ];
}

// This is exactly the `intervention_eligible` boundary deep_research.md means:
// the moment the rule-based decision says an intervention *could* happen right
// now (trigger fired AND minInterventionIntervalMs has elapsed), independent
// of whether a card is ever actually shown. The store logs an
// intervention_eligible event for every candidate returned here, always.
function gateAndLog(
  state: PolicyEngineState,
  params: PolicyParameters,
  now: number,
  candidates: InterventionCandidate[],
): { state: PolicyEngineState; candidates: InterventionCandidate[] } {
  if (withinCooldown(state, params, now)) {
    return { state, candidates: [] };
  }
  if (candidates.length === 0) {
    return { state, candidates: [] };
  }

  return { state: { ...state, eligibilityLog: [...state.eligibilityLog, ...candidates] }, candidates };
}

function withEligibilityGate(
  state: PolicyEngineState,
  params: PolicyParameters,
  graph: HingeGraph,
  now: number,
  extraCandidates: InterventionCandidate[] = [],
): { state: PolicyEngineState; candidates: InterventionCandidate[] } {
  return gateAndLog(state, params, now, [...collectStructuralCandidates(graph, params, now), ...extraCandidates]);
}

export function evaluateOnUtterance(
  state: PolicyEngineState,
  graph: HingeGraph,
  params: PolicyParameters,
  utteranceText: string,
  now: number,
): { state: PolicyEngineState; candidates: InterventionCandidate[] } {
  const recentUtteranceTexts = [...state.recentUtteranceTexts, utteranceText].slice(-RECENT_UTTERANCE_BUFFER_SIZE);
  const nextState: PolicyEngineState = { ...state, lastUtteranceAtMs: now, recentUtteranceTexts };

  const stagnationCandidate = detectStagnationTrigger(
    recentUtteranceTexts, params.stagnationWindowSize, params.stagnationSimilarityThreshold, now,
  );

  return withEligibilityGate(nextState, params, graph, now, stagnationCandidate ? [stagnationCandidate] : []);
}

export function evaluateOnTick(
  state: PolicyEngineState,
  graph: HingeGraph,
  params: PolicyParameters,
  now: number,
): { state: PolicyEngineState; candidates: InterventionCandidate[] } {
  const silenceCandidate = detectSilenceTrigger(state.lastUtteranceAtMs, now, params.silenceThresholdMs);
  return withEligibilityGate(state, params, graph, now, silenceCandidate ? [silenceCandidate] : []);
}

// Called by the store once a card is actually delivered (shown to the user
// after explicit approval) — not on mere eligibility. Resets the cooldown window.
export function markInterventionDelivered(state: PolicyEngineState, now: number): PolicyEngineState {
  return { ...state, lastInterventionAtMs: now };
}

// "Reactive" (deep_research.md) isn't a structural trigger — it's the user
// explicitly asking for help right now. Still respects the same cooldown gate
// as every other trigger (so mashing the button doesn't spam), but bypasses
// graph-gap/contradiction detection entirely.
export function evaluateManualRequest(
  state: PolicyEngineState,
  params: PolicyParameters,
  now: number,
): { state: PolicyEngineState; candidates: InterventionCandidate[] } {
  const manualCandidate: InterventionCandidate = {
    id: createId("cand"),
    triggerType: "manual",
    createdAtMs: now,
    reasonCode: "manual_request",
    reasonSummary: "ユーザーが手動で介入を要求しました。",
    relatedNodeIds: [],
    relatedEdgeIds: [],
    confidence: 1,
    form: "question",
  };
  return gateAndLog(state, params, now, [manualCandidate]);
}
