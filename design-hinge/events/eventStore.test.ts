import { describe, expect, it } from "vitest";
import { appendEvent, createEventStore, selectEventsByType, selectInterventionOutcome } from "./eventStore";
import type { DesignHingeEvent } from "./eventTypes";
import type { InterventionCandidate } from "../policy/types";

function candidate(overrides: Partial<InterventionCandidate> = {}): InterventionCandidate {
  return {
    id: "cand-1",
    triggerType: "graph_gap",
    createdAtMs: 100,
    reasonCode: "isolated_node:node-1",
    reasonSummary: "孤立したノードがあります",
    relatedNodeIds: ["node-1"],
    relatedEdgeIds: [],
    confidence: 0.7,
    form: "question",
    ...overrides,
  };
}

describe("eventStore", () => {
  it("starts empty", () => {
    expect(createEventStore().events).toEqual([]);
  });

  it("appends events without mutating the previous state", () => {
    const store0 = createEventStore();
    const event: DesignHingeEvent = { id: "e1", sessionId: "s1", atMs: 100, type: "session_started" };
    const store1 = appendEvent(store0, event);

    expect(store0.events).toEqual([]);
    expect(store1.events).toEqual([event]);
  });

  it("selects events by type", () => {
    let store = createEventStore();
    store = appendEvent(store, { id: "e1", sessionId: "s1", atMs: 100, type: "session_started" });
    store = appendEvent(store, {
      id: "e2", sessionId: "s1", atMs: 200, type: "intervention_eligible", candidate: candidate(),
    });
    store = appendEvent(store, { id: "e3", sessionId: "s1", atMs: 300, type: "session_ended" });

    const eligible = selectEventsByType(store, "intervention_eligible");
    expect(eligible).toHaveLength(1);
    expect(eligible[0].candidate.id).toBe("cand-1");
  });

  it("reports shadow_only for a candidate that was eligible but never delivered", () => {
    let store = createEventStore();
    store = appendEvent(store, {
      id: "e1", sessionId: "s1", atMs: 100, type: "intervention_eligible", candidate: candidate(),
    });
    expect(selectInterventionOutcome(store, "cand-1")).toBe("shadow_only");
  });

  it("reports delivered, accepted, and dismissed outcomes correctly", () => {
    const card = { ...candidate(), id: "cand-2", questionText: "なぜですか?", phrasingSource: "template" as const };
    let store = createEventStore();
    store = appendEvent(store, { id: "e1", sessionId: "s1", atMs: 100, type: "intervention_delivered", card });
    expect(selectInterventionOutcome(store, "cand-2")).toBe("delivered");

    const acceptedStore = appendEvent(store, {
      id: "e2", sessionId: "s1", atMs: 200, type: "intervention_accepted", cardId: "cand-2",
    });
    expect(selectInterventionOutcome(acceptedStore, "cand-2")).toBe("accepted");

    const dismissedStore = appendEvent(store, {
      id: "e3", sessionId: "s1", atMs: 200, type: "intervention_dismissed", cardId: "cand-2", reason: "user",
    });
    expect(selectInterventionOutcome(dismissedStore, "cand-2")).toBe("dismissed");
  });
});
