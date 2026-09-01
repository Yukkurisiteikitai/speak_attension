import { describe, expect, it } from "vitest";
import { addNode, createInitialHingeGraph } from "../graph/graphEngine";
import type { NewHingeNodeInput } from "../graph/types";
import { DEFAULT_POLICY_PARAMETERS } from "./defaultParameters";
import {
  createInitialPolicyEngineState,
  evaluateManualRequest,
  evaluateOnTick,
  evaluateOnUtterance,
  markInterventionDelivered,
} from "./policyEngine";

function nodeInput(label: string, overrides: Partial<NewHingeNodeInput> = {}): NewHingeNodeInput {
  return {
    type: "custom", label, content: label, origin: "human", confidence: 1,
    sourceSegmentId: null, policyVersion: "policy_0.1", ...overrides,
  };
}

function buildIsolatedNodesGraph(count: number) {
  let graph = createInitialHingeGraph("s");
  for (let i = 0; i < count; i += 1) {
    graph = addNode(graph, nodeInput(`node-${i}`), 100 + i).graph;
  }
  return graph;
}

const params = { ...DEFAULT_POLICY_PARAMETERS, isolatedNodeThreshold: 1, minInterventionIntervalMs: 1000 };

describe("policyEngine", () => {
  it("returns no candidates and does not throw on an empty graph", () => {
    const state = createInitialPolicyEngineState("policy_0.1");
    const graph = createInitialHingeGraph("s");
    const result = evaluateOnUtterance(state, graph, params, "証拠がなければ告発できない", 5000);
    expect(result.candidates).toEqual([]);
  });

  it("surfaces an eligible candidate once the isolated-node threshold is exceeded", () => {
    const state = createInitialPolicyEngineState("policy_0.1");
    const graph = buildIsolatedNodesGraph(3); // threshold=1, so 2 nodes flagged
    const result = evaluateOnUtterance(state, graph, params, "何かの発言", 5000);
    expect(result.candidates).toHaveLength(2);
    expect(result.state.eligibilityLog).toHaveLength(2);
  });

  it("suppresses candidates within the cooldown window after a delivered intervention", () => {
    let state = createInitialPolicyEngineState("policy_0.1");
    state = markInterventionDelivered(state, 5000);
    const graph = buildIsolatedNodesGraph(3);

    const withinCooldown = evaluateOnUtterance(state, graph, params, "発言", 5500); // 500ms < 1000ms interval
    expect(withinCooldown.candidates).toEqual([]);

    const afterCooldown = evaluateOnUtterance(state, graph, params, "発言", 6500); // 1500ms >= 1000ms interval
    expect(afterCooldown.candidates).toHaveLength(2);
  });

  it("tracks lastUtteranceAtMs and a bounded recent-utterance buffer", () => {
    const state = createInitialPolicyEngineState("policy_0.1");
    const graph = createInitialHingeGraph("s");
    const result = evaluateOnUtterance(state, graph, params, "最初の発言", 1000);
    expect(result.state.lastUtteranceAtMs).toBe(1000);
    expect(result.state.recentUtteranceTexts).toEqual(["最初の発言"]);
  });

  it("evaluateOnTick re-checks structural triggers without requiring a new utterance", () => {
    const state = createInitialPolicyEngineState("policy_0.1");
    const graph = buildIsolatedNodesGraph(3);
    const result = evaluateOnTick(state, graph, params, 5000);
    expect(result.candidates).toHaveLength(2);
  });

  it("fires the silence trigger on a tick once enough time has passed since the last utterance", () => {
    const state0 = createInitialPolicyEngineState("policy_0.1");
    const graph = createInitialHingeGraph("s");
    const afterUtterance = evaluateOnUtterance(state0, graph, params, "最初の発言", 1000);

    const tickResult = evaluateOnTick(afterUtterance.state, graph, params, 1000 + params.silenceThresholdMs);
    expect(tickResult.candidates).toHaveLength(1);
    expect(tickResult.candidates[0].triggerType).toBe("silence");
  });

  it("fires the stagnation trigger once the recent-utterance window is filled with repeats", () => {
    let state = createInitialPolicyEngineState("policy_0.1");
    const graph = createInitialHingeGraph("s");
    const localParams = { ...params, minInterventionIntervalMs: 0 };
    let result;
    for (let i = 0; i < 4; i += 1) {
      result = evaluateOnUtterance(state, graph, localParams, "同じ話です", 1000 + i);
      state = result.state;
    }
    expect(result!.candidates.some((c) => c.triggerType === "stagnation")).toBe(true);
  });

  it("evaluateManualRequest always yields exactly one manual candidate, bypassing structural triggers", () => {
    const state = createInitialPolicyEngineState("policy_0.1");
    const result = evaluateManualRequest(state, params, 5000);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].triggerType).toBe("manual");
  });

  it("evaluateManualRequest still respects the cooldown gate", () => {
    let state = createInitialPolicyEngineState("policy_0.1");
    state = markInterventionDelivered(state, 5000);
    const result = evaluateManualRequest(state, params, 5500); // 500ms < 1000ms interval
    expect(result.candidates).toEqual([]);
  });

  it("markInterventionDelivered resets the cooldown clock without touching other state", () => {
    const state = createInitialPolicyEngineState("policy_0.1");
    const delivered = markInterventionDelivered(state, 9999);
    expect(delivered.lastInterventionAtMs).toBe(9999);
    expect(delivered.recentUtteranceTexts).toEqual(state.recentUtteranceTexts);
  });
});
