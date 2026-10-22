import { useEffect, useRef, useSyncExternalStore } from "react";
import { createDesignHingeStore } from "../../design-hinge/store/designHingeStore";
import type { LlmSettings } from "../utils/llmClient";

const TICK_INTERVAL_MS = 2000;

type UseDesignHingeStoreOptions = {
  llmSettings?: LlmSettings | null;
};

// React-facing adapter over the imperative design-hinge store, mirroring
// useTopicEngine.ts's shape: a stable store instance in a ref, a
// useSyncExternalStore subscription for the snapshot, and a tick timer
// (here driving the Silence trigger, which only fires on tick() — see
// design-hinge/policy/policyEngine.ts's evaluateOnTick).
export function useDesignHingeStore({ llmSettings }: UseDesignHingeStoreOptions = {}) {
  const storeRef = useRef<ReturnType<typeof createDesignHingeStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createDesignHingeStore({ llmSettings });
  }

  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    store.setLlmSettings(llmSettings ?? null);
  }, [llmSettings, store]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      store.tick(Date.now());
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [store]);

  return {
    activeCard: snapshot.activeCard,
    events: snapshot.events,
    graph: snapshot.graph,
    policyEnabled: snapshot.policyEnabled,
    policyParameters: snapshot.policyParameters,
    pendingCandidateQueue: snapshot.pendingCandidateQueue,
    pendingProposals: snapshot.pendingProposals,
    sessionId: snapshot.sessionId,
    acceptEdgeProposal: store.acceptEdgeProposal,
    acceptNodeProposal: store.acceptNodeProposal,
    approveIntervention: store.approveIntervention,
    createCounterfactual: store.createCounterfactual,
    dismissIntervention: store.dismissIntervention,
    exportSession: store.exportSession,
    ingestUtterance: store.ingestUtterance,
    rejectEdgeProposal: store.rejectEdgeProposal,
    requestManualIntervention: store.requestManualIntervention,
    reset: store.reset,
    setPolicyEnabled: store.setPolicyEnabled,
    setPolicyParameters: store.setPolicyParameters,
  };
}
