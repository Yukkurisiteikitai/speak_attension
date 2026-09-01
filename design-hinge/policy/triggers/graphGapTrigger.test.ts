import { describe, expect, it } from "vitest";
import { addEdge, addNode, createInitialHingeGraph } from "../../graph/graphEngine";
import type { NewHingeEdgeInput, NewHingeNodeInput } from "../../graph/types";
import { detectGraphGapTrigger } from "./graphGapTrigger";

function nodeInput(label: string, overrides: Partial<NewHingeNodeInput> = {}): NewHingeNodeInput {
  return {
    type: "custom", label, content: label, origin: "human", confidence: 1,
    sourceSegmentId: null, policyVersion: "policy_0.1", ...overrides,
  };
}

function edgeInput(source: string, target: string, overrides: Partial<NewHingeEdgeInput> = {}): NewHingeEdgeInput {
  return {
    source, target, relation: "causes", confidence: 0.6, evidenceType: "user_hypothesis",
    provenance: "human", testStatus: "untested", scope: "this_work_only", ...overrides,
  };
}

describe("detectGraphGapTrigger", () => {
  it("tolerates isolated nodes up to the threshold", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;

    const candidates = detectGraphGapTrigger(graph, 2, 0.8, 200);
    expect(candidates).toEqual([]);
  });

  it("flags isolated nodes beyond the tolerated threshold, oldest first", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;
    const c = addNode(graph, nodeInput("C"), 102);
    graph = c.graph;

    const candidates = detectGraphGapTrigger(graph, 2, 0.8, 200);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].relatedNodeIds).toEqual([c.node.id]);
    expect(candidates[0].reasonCode).toBe(`isolated_node:${c.node.id}`);
  });

  it("flags edges below the causal confidence threshold for confirmation", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;
    const edge = addEdge(graph, edgeInput(a.node.id, b.node.id, { confidence: 0.3 }), 102);
    graph = edge.graph;

    const candidates = detectGraphGapTrigger(graph, 2, 0.8, 200);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasonCode).toBe(`low_confidence_edge:${edge.edge.id}`);
    expect(candidates[0].relatedEdgeIds).toEqual([edge.edge.id]);
  });

  it("does not flag edges at or above the causal confidence threshold", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;
    const edge = addEdge(graph, edgeInput(a.node.id, b.node.id, { confidence: 0.8 }), 102);
    graph = edge.graph;

    expect(detectGraphGapTrigger(graph, 2, 0.8, 200)).toEqual([]);
  });
});
