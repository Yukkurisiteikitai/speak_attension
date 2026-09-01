import { describe, expect, it } from "vitest";
import { createDesignHingeStore } from "./designHingeStore";
import { DEFAULT_POLICY_PARAMETERS } from "../policy/defaultParameters";

// currentLlmSettings is left unset throughout: refinePhrasingForCard short-circuits
// on `!currentLlmSettings?.model`, so these tests exercise only the mandatory
// rule-based/template path deterministically, with no network calls. The LLM
// phrasing call itself (success + failure paths) is covered with an injected
// fake chat function in policy/llmPhrasing.test.ts.

describe("designHingeStore", () => {
  it("proposes a node/edge pair on ingest and records the events", () => {
    const store = createDesignHingeStore();
    // Every freshly-ingested edge starts at confidence 0.6 (utteranceIngestion.ts's
    // rule-based default), which is below the default causalConfidenceThreshold
    // (0.8) and would immediately queue a "please confirm" graph_gap candidate
    // too. Set the threshold to 0 here to isolate this test's actual subject:
    // the shape of the proposal events themselves, not policy-engine side effects.
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, causalConfidenceThreshold: 0 });
    store.ingestUtterance("証拠がなければ告発できない", "manual");

    const snapshot = store.getSnapshot();
    expect(snapshot.graph.nodes.map((n) => n.label)).toEqual(["証拠", "告発"]);
    expect(snapshot.graph.edges).toHaveLength(1);
    expect(snapshot.pendingProposals.nodes).toHaveLength(2);
    expect(snapshot.pendingProposals.edges).toHaveLength(1);

    const types = snapshot.events.map((e) => e.type);
    expect(types).toEqual(["session_started", "utterance_ingested", "node_proposed", "node_proposed", "edge_proposed"]);
  });

  it("ignores blank/whitespace-only utterances", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("   ", "manual");
    expect(store.getSnapshot().events).toHaveLength(1); // just session_started
  });

  it("accepts a node proposal, removing it from the pending list and logging node_created", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const nodeId = store.getSnapshot().pendingProposals.nodes[0].id;

    store.acceptNodeProposal(nodeId);
    const snapshot = store.getSnapshot();
    expect(snapshot.pendingProposals.nodes.some((n) => n.id === nodeId)).toBe(false);
    expect(snapshot.events.at(-1)).toMatchObject({ type: "node_created", nodeId });
  });

  it("rejects an edge proposal, removing it from both the graph and the pending list", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const edgeId = store.getSnapshot().pendingProposals.edges[0].id;

    store.rejectEdgeProposal(edgeId);
    const snapshot = store.getSnapshot();
    expect(snapshot.graph.edges).toHaveLength(0);
    expect(snapshot.pendingProposals.edges).toHaveLength(0);
    expect(snapshot.events.at(-1)).toMatchObject({ type: "edge_rejected", edgeId });
  });

  it("accepts an edge proposal without removing it from the graph, only from pending review", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const edgeId = store.getSnapshot().pendingProposals.edges[0].id;

    store.acceptEdgeProposal(edgeId);
    const snapshot = store.getSnapshot();
    expect(snapshot.graph.edges).toHaveLength(1);
    expect(snapshot.pendingProposals.edges).toHaveLength(0);
    expect(snapshot.events.at(-1)).toMatchObject({ type: "edge_accepted", edgeId });
  });

  // A node created via ingestion always starts connected (it exists because
  // it was one end of a proposed edge), so the only realistic way to produce
  // a genuinely isolated node is to reject that edge afterward, then re-run
  // policy evaluation via tick().
  function buildStoreWithIsolatedNodeCard() {
    const store = createDesignHingeStore();
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, isolatedNodeThreshold: 0 });
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const edgeId = store.getSnapshot().pendingProposals.edges[0].id;
    store.rejectEdgeProposal(edgeId);
    store.tick(Date.now());
    return store;
  }

  it("surfaces an isolated-node graph-gap intervention as a template-phrased active card", () => {
    const store = buildStoreWithIsolatedNodeCard();
    const snapshot = store.getSnapshot();
    expect(snapshot.activeCard).not.toBeNull();
    expect(snapshot.activeCard?.phrasingSource).toBe("template");
    expect(snapshot.activeCard?.triggerType).toBe("graph_gap");
    expect(snapshot.events.some((e) => e.type === "intervention_eligible")).toBe(true);
  });

  it("approveIntervention logs intervention_delivered and resets the policy cooldown", () => {
    const store = buildStoreWithIsolatedNodeCard();
    const cardId = store.getSnapshot().activeCard!.id;
    store.approveIntervention(cardId);

    const snapshot = store.getSnapshot();
    expect(snapshot.events.at(-1)).toMatchObject({ type: "intervention_delivered" });
    expect(snapshot.policyState.lastInterventionAtMs).not.toBeNull();
  });

  it("approveIntervention is a no-op for a stale/mismatched card id", () => {
    const store = buildStoreWithIsolatedNodeCard();
    const before = store.getSnapshot();

    store.approveIntervention("nonexistent-card-id");
    expect(store.getSnapshot()).toBe(before);
  });

  it("dismissIntervention clears the active card when nothing else is queued, and logs intervention_dismissed", () => {
    // Uses requestManualIntervention rather than the isolated-node fixture:
    // that fixture's graph legitimately queues multiple eligible candidates
    // (the rejected edge's own low-confidence check plus two now-isolated
    // nodes), so dismissing one promotes the next — correct cascading
    // behavior, but not what this test is isolating. A manual request is
    // guaranteed to be the only candidate in play.
    const store = createDesignHingeStore();
    store.requestManualIntervention();
    const cardId = store.getSnapshot().activeCard!.id;
    store.dismissIntervention(cardId, "user");

    const snapshot = store.getSnapshot();
    expect(snapshot.activeCard).toBeNull();
    expect(snapshot.events.some((e) => e.type === "intervention_dismissed" && e.cardId === cardId)).toBe(true);
  });

  it("dismissIntervention promotes the next queued candidate when more than one was eligible", () => {
    const store = buildStoreWithIsolatedNodeCard();
    const firstCardId = store.getSnapshot().activeCard!.id;
    store.dismissIntervention(firstCardId, "user");

    const snapshot = store.getSnapshot();
    expect(snapshot.activeCard).not.toBeNull();
    expect(snapshot.activeCard?.id).not.toBe(firstCardId);
  });

  it("requestManualIntervention synthesizes a manual candidate and respects the cooldown", () => {
    const store = createDesignHingeStore();
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, minInterventionIntervalMs: 10_000_000 });

    store.requestManualIntervention();
    const first = store.getSnapshot();
    expect(first.activeCard?.triggerType).toBe("manual");

    store.approveIntervention(first.activeCard!.id);
    store.dismissIntervention(first.activeCard!.id, "user");
    store.requestManualIntervention(); // within cooldown now, should be suppressed
    expect(store.getSnapshot().activeCard).toBeNull();
  });

  it("createCounterfactual computes a diff and logs counterfactual_created", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const nodeId = store.getSnapshot().graph.nodes[0].id;

    const diff = store.createCounterfactual({ nodeId });
    expect(diff.removedNodeId).toBe(nodeId);
    expect(store.getSnapshot().events.at(-1)).toMatchObject({ type: "counterfactual_created", nodeId });
  });

  it("createCounterfactual returns a no-op result without logging when no target is given", () => {
    const store = createDesignHingeStore();
    const before = store.getSnapshot().events.length;
    const diff = store.createCounterfactual({});
    expect(diff.summary).toContain("対象が指定されていません");
    expect(store.getSnapshot().events.length).toBe(before);
  });

  it("exportSession produces a versioned export matching the current graph/events/policy", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const exported = store.exportSession();

    expect(exported.version).toBe(1);
    expect(exported.kind).toBe("design_hinge_session");
    expect(exported.graph).toEqual(store.getSnapshot().graph);
    expect(exported.events).toEqual(store.getSnapshot().events);
  });

  it("reset produces a fresh session with a new id and cleared state", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const before = store.getSnapshot();

    store.reset();
    const after = store.getSnapshot();
    expect(after.sessionId).not.toBe(before.sessionId);
    expect(after.graph.nodes).toHaveLength(0);
    expect(after.events).toHaveLength(1); // just session_started
  });

  it("notifies subscribers on every state change and stops after unsubscribe", () => {
    const store = createDesignHingeStore();
    let callCount = 0;
    const unsubscribe = store.subscribe(() => {
      callCount += 1;
    });

    store.ingestUtterance("証拠がなければ告発できない", "manual");
    expect(callCount).toBeGreaterThan(0);

    unsubscribe();
    const countAfterUnsub = callCount;
    store.ingestUtterance("別の発言です", "manual");
    expect(callCount).toBe(countAfterUnsub);
  });

  it("tick is a no-op when the policy is disabled", () => {
    const store = createDesignHingeStore();
    store.setPolicyParameters({ ...DEFAULT_POLICY_PARAMETERS, isolatedNodeThreshold: 0 });
    store.setPolicyEnabled(false);
    store.ingestUtterance("証拠がなければ告発できない", "manual");
    const edgeId = store.getSnapshot().pendingProposals.edges[0].id;
    store.rejectEdgeProposal(edgeId);
    store.tick(Date.now() + 100000);
    expect(store.getSnapshot().activeCard).toBeNull();
  });

  // Regression test: found via manual browser testing. Nothing resets the
  // cooldown until a card is actually delivered, so an unresolved issue (here,
  // a never-approved low-confidence edge) kept re-appearing as a *new* queued
  // candidate on every tick, growing the queue forever instead of surfacing
  // the same open issue once.
  it("does not accumulate duplicate candidates for the same unresolved issue across repeated ticks", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual"); // edge confidence 0.6 < default threshold 0.8

    const afterIngest = store.getSnapshot();
    const totalCandidatesAfterIngest = afterIngest.pendingCandidateQueue.length + (afterIngest.activeCard ? 1 : 0);
    expect(totalCandidatesAfterIngest).toBe(1);

    // Kept under the default 6s silenceThresholdMs so the silence trigger
    // doesn't also legitimately join in — this test isolates duplicate
    // accumulation of a single issue, not the (correct) appearance of a
    // second, distinct one.
    let now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      now += 500;
      store.tick(now);
    }

    const afterTicks = store.getSnapshot();
    const totalCandidatesAfterTicks = afterTicks.pendingCandidateQueue.length + (afterTicks.activeCard ? 1 : 0);
    expect(totalCandidatesAfterTicks).toBe(1);
  });

  it("still surfaces silence as a second, distinct issue once its own threshold is crossed, without duplicating either issue", () => {
    const store = createDesignHingeStore();
    store.ingestUtterance("証拠がなければ告発できない", "manual"); // queues/activates the low-confidence-edge candidate

    let now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      now += 2000; // 10s total, crosses the default 6s silenceThresholdMs
      store.tick(now);
    }

    const snapshot = store.getSnapshot();
    const allCandidates = [...(snapshot.activeCard ? [snapshot.activeCard] : []), ...snapshot.pendingCandidateQueue];
    const reasonCodes = allCandidates.map((c) => c.reasonCode);

    expect(reasonCodes).toHaveLength(2); // the original edge issue + silence, each exactly once
    expect(new Set(reasonCodes).size).toBe(2); // no duplicates
    expect(reasonCodes).toContain("silence");
    expect(reasonCodes.some((code) => code.startsWith("low_confidence_edge:"))).toBe(true);
  });
});
