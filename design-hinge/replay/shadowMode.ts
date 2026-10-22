import { createId } from "../ids";
import { createInitialHingeGraph } from "../graph/graphEngine";
import { ingestUtteranceIntoGraph } from "../graph/utteranceIngestion";
import { createInitialPolicyEngineState, evaluateOnUtterance } from "../policy/policyEngine";
import type { PolicyParameters } from "../policy/defaultParameters";
import type { InterventionCandidate, InterventionOutcome } from "../policy/types";
import { selectInterventionOutcome, type EventStoreState } from "../events/eventStore";
import type { DesignHingeEvent } from "../events/eventTypes";
import type { DesignHingeSessionExport } from "../events/exportEvents";

export type ShadowModeInput = {
  export: DesignHingeSessionExport;
  policyParameters: PolicyParameters;
  policyVersion: string;
};

export type ShadowDecisionLogEntry = {
  atMs: number;
  utteranceText: string;
  wouldTrigger: boolean;
  candidates: InterventionCandidate[];
  actualOutcome: InterventionOutcome | "not_applicable";
  agreesWithActual: boolean;
};

export type ShadowModeReport = {
  sessionId: string;
  replayedPolicyVersion: string;
  originalPolicyVersion: string;
  decisions: ShadowDecisionLogEntry[];
  overTriggerRate: number;
  underTriggerRate: number;
  summary: string;
};

function collectEventsAtMs<T extends DesignHingeEvent["type"]>(
  events: DesignHingeEvent[],
  type: T,
  atMs: number,
): Array<Extract<DesignHingeEvent, { type: T }>> {
  return events.filter((event): event is Extract<DesignHingeEvent, { type: T }> => event.type === type && event.atMs === atMs);
}

// Representative simplification: reports the first eligible candidate's
// outcome at this timestamp. In the real store, only one candidate is
// normally promoted to an active card per utterance; the rest remain queued
// (shadow_only) until later, so this is a reasonable stand-in for "did the
// original policy do anything here at all."
function resolveActualOutcome(events: DesignHingeEvent[], atMs: number): InterventionOutcome | "not_applicable" {
  const eligible = collectEventsAtMs(events, "intervention_eligible", atMs);
  if (eligible.length === 0) return "not_applicable";
  const store: EventStoreState = { events };
  return selectInterventionOutcome(store, eligible[0].candidate.id);
}

// Offline replay: take an exported session's utterance log, re-run it through
// a (possibly different) Policy Engine version, and compare eligibility
// decisions against what the original policy actually decided at each point.
// Rebuilds its own parallel graph from scratch via ingestUtteranceIntoGraph
// rather than reusing the exported graph's literal node/edge ids — this is a
// simulation of an alternative policy, not a literal replay of stored state.
//
// Known limitation: only utterance-triggered eligibility (graph_gap,
// contradiction, stagnation) is replayed. Silence is tick-based and no tick
// events are persisted in the log, so silence-trigger opportunities between
// utterances aren't represented here.
export function replaySessionThroughPolicy(input: ShadowModeInput): ShadowModeReport {
  const { export: sessionExport, policyParameters, policyVersion } = input;
  const originalEvents = sessionExport.events;
  const utteranceEvents = originalEvents.filter(
    (event): event is Extract<DesignHingeEvent, { type: "utterance_ingested" }> => event.type === "utterance_ingested",
  );

  let graph = createInitialHingeGraph(sessionExport.sessionId);
  let policyState = createInitialPolicyEngineState(policyVersion);
  const decisions: ShadowDecisionLogEntry[] = [];

  for (const event of utteranceEvents) {
    const segmentId = createId("seg");
    const ingestion = ingestUtteranceIntoGraph(graph, event.text, segmentId, policyVersion, event.atMs);
    graph = ingestion.graph;

    const result = evaluateOnUtterance(policyState, graph, policyParameters, event.text, event.atMs);
    policyState = result.state;

    const wouldTrigger = result.candidates.length > 0;
    const actualOutcome = resolveActualOutcome(originalEvents, event.atMs);
    const agreesWithActual = wouldTrigger === (actualOutcome !== "not_applicable");

    decisions.push({ atMs: event.atMs, utteranceText: event.text, wouldTrigger, candidates: result.candidates, actualOutcome, agreesWithActual });
  }

  const total = decisions.length;
  const overTriggerCount = decisions.filter((d) => d.wouldTrigger && d.actualOutcome === "not_applicable").length;
  const underTriggerCount = decisions.filter((d) => !d.wouldTrigger && d.actualOutcome !== "not_applicable").length;
  const overTriggerRate = total === 0 ? 0 : overTriggerCount / total;
  const underTriggerRate = total === 0 ? 0 : underTriggerCount / total;

  const summary =
    total === 0
      ? "発話イベントが記録されていないため、比較できません。"
      : `${total}件の発話のうち、過剰介入の可能性が${overTriggerCount}件（${(overTriggerRate * 100).toFixed(1)}%）、` +
        `見逃しの可能性が${underTriggerCount}件（${(underTriggerRate * 100).toFixed(1)}%）でした。`;

  return {
    sessionId: sessionExport.sessionId,
    replayedPolicyVersion: policyVersion,
    originalPolicyVersion: sessionExport.policyVersion,
    decisions,
    overTriggerRate,
    underTriggerRate,
    summary,
  };
}
