import { createId } from "../ids";
import { createInitialHingeGraph, removeEdge } from "../graph/graphEngine";
import { computeCounterfactualEdgeRemoval, computeCounterfactualNodeRemoval, type GraphDiffResult } from "../graph/graphDiff";
import { ingestUtteranceIntoGraph } from "../graph/utteranceIngestion";
import type { HingeEdge, HingeGraph, HingeNode } from "../graph/types";
import { DEFAULT_POLICY_PARAMETERS, POLICY_VERSION, type PolicyParameters } from "../policy/defaultParameters";
import {
  createInitialPolicyEngineState,
  evaluateManualRequest,
  evaluateOnTick,
  evaluateOnUtterance,
  markInterventionDelivered,
  type PolicyEngineState,
} from "../policy/policyEngine";
import { buildTemplateQuestion } from "../policy/phraseTemplates";
import { refinePhrasingWithLlm } from "../policy/llmPhrasing";
import type { InterventionCandidate, InterventionCard } from "../policy/types";
import { buildDesignHingeExport, type DesignHingeSessionExport } from "../events/exportEvents";
import type { DesignHingeEvent, TranscriptInputSource } from "../events/eventTypes";
import type { LlmSettings } from "../../src/utils/llmClient";

export type DesignHingeStoreSnapshot = {
  sessionId: string;
  graph: HingeGraph;
  policyState: PolicyEngineState;
  policyParameters: PolicyParameters;
  policyEnabled: boolean;
  events: DesignHingeEvent[];
  pendingProposals: { nodes: HingeNode[]; edges: HingeEdge[] };
  pendingCandidateQueue: InterventionCandidate[];
  activeCard: InterventionCard | null;
};

export type DesignHingeStore = {
  ingestUtterance: (text: string, source: TranscriptInputSource) => void;
  tick: (now: number) => void;
  acceptNodeProposal: (nodeId: string) => void;
  acceptEdgeProposal: (edgeId: string) => void;
  rejectEdgeProposal: (edgeId: string) => void;
  approveIntervention: (cardId: string) => void;
  dismissIntervention: (cardId: string, reason: "user" | "timeout" | "superseded") => void;
  createCounterfactual: (target: { nodeId?: string; edgeId?: string }) => GraphDiffResult;
  setLlmSettings: (settings: LlmSettings | null) => void;
  setPolicyParameters: (params: PolicyParameters) => void;
  setPolicyEnabled: (enabled: boolean) => void;
  requestManualIntervention: () => void;
  exportSession: () => DesignHingeSessionExport;
  reset: () => void;
  getSnapshot: () => DesignHingeStoreSnapshot;
  subscribe: (listener: () => void) => () => void;
};

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Structural triggers (graph_gap, contradiction) re-evaluate the same graph
// state on every utterance/tick, so an unresolved issue keeps being detected
// as "eligible" for as long as it stays unresolved (nothing has been
// delivered to reset the cooldown). Without this, the queue would grow by one
// duplicate candidate every tick. Dedupe by reasonCode against what's already
// pending/active before enqueueing — every detection is still logged as an
// intervention_eligible event; only re-queueing the same open issue is suppressed.
function dedupeAgainstPending(
  candidates: InterventionCandidate[],
  activeCard: InterventionCard | null,
  pendingCandidateQueue: InterventionCandidate[],
): InterventionCandidate[] {
  const pendingReasonCodes = new Set([
    ...(activeCard ? [activeCard.reasonCode] : []),
    ...pendingCandidateQueue.map((candidate) => candidate.reasonCode),
  ]);
  return candidates.filter((candidate) => !pendingReasonCodes.has(candidate.reasonCode));
}

// Full integration: mirrors src/hooks/topicEngineStore.ts's shape — rule-based
// results (ingestion, trigger gating, template phrasing) are applied first and
// synchronously; the LLM phrasing call is a best-effort async patch afterward,
// never blocking card delivery and never touching node/edge creation.
export function createDesignHingeStore(options: { llmSettings?: LlmSettings | null } = {}): DesignHingeStore {
  let currentLlmSettings: LlmSettings | null = options.llmSettings ?? null;
  let sessionEpoch = 0;
  let isPhrasingInProgress = false;

  function initialSnapshot(): DesignHingeStoreSnapshot {
    const sessionId = createId("session");
    const now = Date.now();
    return {
      sessionId,
      graph: createInitialHingeGraph(sessionId),
      policyState: createInitialPolicyEngineState(POLICY_VERSION),
      policyParameters: DEFAULT_POLICY_PARAMETERS,
      policyEnabled: true,
      events: [{ id: createId("evt"), sessionId, atMs: now, type: "session_started" }],
      pendingProposals: { nodes: [], edges: [] },
      pendingCandidateQueue: [],
      activeCard: null,
    };
  }

  let snapshot: DesignHingeStoreSnapshot = initialSnapshot();
  const listeners = new Set<() => void>();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function writeSnapshot(next: DesignHingeStoreSnapshot) {
    snapshot = next;
    emit();
  }

  function nextEventId(): string {
    return createId("evt");
  }

  // If no card is currently active and something is queued, promote the next
  // eligible candidate to activeCard with its (already-computed) template
  // question. This does NOT count as "delivered" yet — the card sits inert
  // until approveIntervention() is called, per this repo's deliberate
  // deviation from deep_research.md's auto-show-card default (see the plan's
  // ADR note: this repo can never do voice, so auto-showing cards would
  // silently reintroduce the interruption risk voice would have carried).
  function fillActiveCardIfIdle(now: number) {
    if (snapshot.activeCard !== null) return;
    if (snapshot.pendingCandidateQueue.length === 0) return;

    const [candidate, ...rest] = snapshot.pendingCandidateQueue;
    const questionText = buildTemplateQuestion(candidate, snapshot.graph);
    const card: InterventionCard = { ...candidate, questionText, phrasingSource: "template" };

    writeSnapshot({ ...snapshot, pendingCandidateQueue: rest, activeCard: card });
    void refinePhrasingForCard(card);
  }

  async function refinePhrasingForCard(card: InterventionCard) {
    if (!currentLlmSettings?.model) return;
    if (isPhrasingInProgress) return;
    isPhrasingInProgress = true;
    const epoch = sessionEpoch;

    try {
      const results = await refinePhrasingWithLlm(currentLlmSettings, [
        { candidateId: card.id, triggerType: card.triggerType, templateQuestion: card.questionText, context: card.reasonSummary },
      ]);
      if (epoch !== sessionEpoch) return;
      if (snapshot.activeCard?.id !== card.id) return; // dismissed/replaced while awaiting LLM

      const result = results[0];
      if (!result) return;
      writeSnapshot({
        ...snapshot,
        activeCard: { ...snapshot.activeCard, questionText: result.questionText, phrasingSource: "llm" },
      });
    } catch {
      // Best-effort only: the template text already shown stays as-is.
      // Mirrors topicEngineStore.ts's processTitleRefineQueue catch block.
    } finally {
      isPhrasingInProgress = false;
    }
  }

  return {
    ingestUtterance(text, source) {
      const cleaned = cleanText(text);
      if (!cleaned) return;
      const now = Date.now();
      const sessionId = snapshot.sessionId;
      const segmentId = createId("seg");

      const utteranceEvent: DesignHingeEvent = { id: nextEventId(), sessionId, atMs: now, type: "utterance_ingested", text: cleaned, source };

      const ingestion = ingestUtteranceIntoGraph(snapshot.graph, cleaned, segmentId, snapshot.policyState.policyVersion, now);
      const nodeEvents: DesignHingeEvent[] = ingestion.proposedNodes.map((node) => ({
        id: nextEventId(), sessionId, atMs: now, type: "node_proposed", node,
      }));
      const edgeEvents: DesignHingeEvent[] = ingestion.proposedEdges.map((edge) => ({
        id: nextEventId(), sessionId, atMs: now, type: "edge_proposed", edge,
      }));

      let next: DesignHingeStoreSnapshot = {
        ...snapshot,
        graph: ingestion.graph,
        events: [...snapshot.events, utteranceEvent, ...nodeEvents, ...edgeEvents],
        pendingProposals: {
          nodes: [...snapshot.pendingProposals.nodes, ...ingestion.proposedNodes],
          edges: [...snapshot.pendingProposals.edges, ...ingestion.proposedEdges],
        },
      };

      if (next.policyEnabled) {
        const { state: nextPolicyState, candidates } = evaluateOnUtterance(
          next.policyState, next.graph, next.policyParameters, cleaned, now,
        );
        const eligibleEvents: DesignHingeEvent[] = candidates.map((candidate) => ({
          id: nextEventId(), sessionId, atMs: now, type: "intervention_eligible", candidate,
        }));
        next = {
          ...next,
          policyState: nextPolicyState,
          events: [...next.events, ...eligibleEvents],
          pendingCandidateQueue: [
            ...next.pendingCandidateQueue,
            ...dedupeAgainstPending(candidates, next.activeCard, next.pendingCandidateQueue),
          ],
        };
      }

      writeSnapshot(next);
      fillActiveCardIfIdle(now);
    },

    tick(now) {
      if (!snapshot.policyEnabled) return;
      const { state: nextPolicyState, candidates } = evaluateOnTick(snapshot.policyState, snapshot.graph, snapshot.policyParameters, now);
      if (candidates.length === 0) {
        if (nextPolicyState !== snapshot.policyState) writeSnapshot({ ...snapshot, policyState: nextPolicyState });
        return;
      }

      const sessionId = snapshot.sessionId;
      const eligibleEvents: DesignHingeEvent[] = candidates.map((candidate) => ({
        id: nextEventId(), sessionId, atMs: now, type: "intervention_eligible", candidate,
      }));
      writeSnapshot({
        ...snapshot,
        policyState: nextPolicyState,
        events: [...snapshot.events, ...eligibleEvents],
        pendingCandidateQueue: [
          ...snapshot.pendingCandidateQueue,
          ...dedupeAgainstPending(candidates, snapshot.activeCard, snapshot.pendingCandidateQueue),
        ],
      });
      fillActiveCardIfIdle(now);
    },

    acceptNodeProposal(nodeId) {
      if (!snapshot.pendingProposals.nodes.some((node) => node.id === nodeId)) return;
      const now = Date.now();
      writeSnapshot({
        ...snapshot,
        events: [...snapshot.events, { id: nextEventId(), sessionId: snapshot.sessionId, atMs: now, type: "node_created", nodeId }],
        pendingProposals: {
          ...snapshot.pendingProposals,
          nodes: snapshot.pendingProposals.nodes.filter((node) => node.id !== nodeId),
        },
      });
    },

    acceptEdgeProposal(edgeId) {
      if (!snapshot.pendingProposals.edges.some((edge) => edge.id === edgeId)) return;
      const now = Date.now();
      writeSnapshot({
        ...snapshot,
        events: [...snapshot.events, { id: nextEventId(), sessionId: snapshot.sessionId, atMs: now, type: "edge_accepted", edgeId }],
        pendingProposals: {
          ...snapshot.pendingProposals,
          edges: snapshot.pendingProposals.edges.filter((edge) => edge.id !== edgeId),
        },
      });
    },

    rejectEdgeProposal(edgeId) {
      if (!snapshot.pendingProposals.edges.some((edge) => edge.id === edgeId)) return;
      const now = Date.now();
      writeSnapshot({
        ...snapshot,
        graph: removeEdge(snapshot.graph, edgeId),
        events: [...snapshot.events, { id: nextEventId(), sessionId: snapshot.sessionId, atMs: now, type: "edge_rejected", edgeId }],
        pendingProposals: {
          ...snapshot.pendingProposals,
          edges: snapshot.pendingProposals.edges.filter((edge) => edge.id !== edgeId),
        },
      });
    },

    approveIntervention(cardId) {
      if (snapshot.activeCard?.id !== cardId) return;
      const now = Date.now();
      const card = snapshot.activeCard;
      writeSnapshot({
        ...snapshot,
        policyState: markInterventionDelivered(snapshot.policyState, now),
        events: [...snapshot.events, { id: nextEventId(), sessionId: snapshot.sessionId, atMs: now, type: "intervention_delivered", card }],
      });
    },

    dismissIntervention(cardId, reason) {
      if (snapshot.activeCard?.id !== cardId) return;
      const now = Date.now();
      writeSnapshot({
        ...snapshot,
        events: [...snapshot.events, { id: nextEventId(), sessionId: snapshot.sessionId, atMs: now, type: "intervention_dismissed", cardId, reason }],
        activeCard: null,
      });
      fillActiveCardIfIdle(now);
    },

    createCounterfactual(target) {
      const now = Date.now();
      if (!target.nodeId && !target.edgeId) {
        return { affectedNodeIds: [], brokenEdges: [], summary: "対象が指定されていません。" };
      }

      const diff = target.nodeId
        ? computeCounterfactualNodeRemoval(snapshot.graph, target.nodeId)
        : computeCounterfactualEdgeRemoval(snapshot.graph, target.edgeId!);

      writeSnapshot({
        ...snapshot,
        events: [
          ...snapshot.events,
          { id: nextEventId(), sessionId: snapshot.sessionId, atMs: now, type: "counterfactual_created", nodeId: target.nodeId, edgeId: target.edgeId, diff },
        ],
      });
      return diff;
    },

    setLlmSettings(settings) {
      currentLlmSettings = settings;
    },

    setPolicyParameters(params) {
      writeSnapshot({ ...snapshot, policyParameters: params });
    },

    setPolicyEnabled(enabled) {
      writeSnapshot({ ...snapshot, policyEnabled: enabled });
    },

    requestManualIntervention() {
      const now = Date.now();
      const { state: nextPolicyState, candidates } = evaluateManualRequest(snapshot.policyState, snapshot.policyParameters, now);
      if (candidates.length === 0) return;

      const sessionId = snapshot.sessionId;
      const eligibleEvents: DesignHingeEvent[] = candidates.map((candidate) => ({
        id: nextEventId(), sessionId, atMs: now, type: "intervention_eligible", candidate,
      }));
      writeSnapshot({
        ...snapshot,
        policyState: nextPolicyState,
        events: [...snapshot.events, ...eligibleEvents],
        pendingCandidateQueue: [
          ...snapshot.pendingCandidateQueue,
          ...dedupeAgainstPending(candidates, snapshot.activeCard, snapshot.pendingCandidateQueue),
        ],
      });
      fillActiveCardIfIdle(now);
    },

    exportSession() {
      return buildDesignHingeExport({
        sessionId: snapshot.sessionId,
        policyVersion: snapshot.policyState.policyVersion,
        policyParameters: snapshot.policyParameters,
        graph: snapshot.graph,
        events: snapshot.events,
      });
    },

    reset() {
      sessionEpoch += 1;
      isPhrasingInProgress = false;
      writeSnapshot(initialSnapshot());
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
