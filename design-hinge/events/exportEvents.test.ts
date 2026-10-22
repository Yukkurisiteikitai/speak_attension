import { describe, expect, it } from "vitest";
import { buildDesignHingeExport } from "./exportEvents";
import { createInitialHingeGraph } from "../graph/graphEngine";
import { DEFAULT_POLICY_PARAMETERS, POLICY_VERSION } from "../policy/defaultParameters";
import type { DesignHingeEvent } from "./eventTypes";

describe("buildDesignHingeExport", () => {
  it("produces a versioned export matching ideaSession's export shape", () => {
    const events: DesignHingeEvent[] = [{ id: "e1", sessionId: "s1", atMs: 100, type: "session_started" }];
    const graph = createInitialHingeGraph("s1");

    const exported = buildDesignHingeExport(
      { sessionId: "s1", policyVersion: POLICY_VERSION, policyParameters: DEFAULT_POLICY_PARAMETERS, graph, events },
      12345,
    );

    expect(exported).toEqual({
      version: 1,
      kind: "design_hinge_session",
      generatedAt: 12345,
      sessionId: "s1",
      policyVersion: POLICY_VERSION,
      policyParameters: DEFAULT_POLICY_PARAMETERS,
      graph,
      events,
    });
  });

  it("defaults generatedAt to now when omitted", () => {
    const before = Date.now();
    const exported = buildDesignHingeExport({
      sessionId: "s1",
      policyVersion: POLICY_VERSION,
      policyParameters: DEFAULT_POLICY_PARAMETERS,
      graph: createInitialHingeGraph("s1"),
      events: [],
    });
    const after = Date.now();
    expect(exported.generatedAt).toBeGreaterThanOrEqual(before);
    expect(exported.generatedAt).toBeLessThanOrEqual(after);
  });
});
