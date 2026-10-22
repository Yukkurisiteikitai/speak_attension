import { describe, expect, it } from "vitest";
import { addEdge, addNode, createInitialHingeGraph } from "../../graph/graphEngine";
import type { NewHingeEdgeInput, NewHingeNodeInput } from "../../graph/types";
import { detectContradictionTrigger } from "./contradictionTrigger";

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

describe("detectContradictionTrigger", () => {
  it("flags a contradiction when at least one edge is confident enough to matter", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("嘘をつく"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("信頼を失う"), 101);
    graph = b.graph;
    const causesEdge = addEdge(graph, edgeInput(a.node.id, b.node.id, { relation: "causes", confidence: 0.9 }), 102);
    graph = causesEdge.graph;
    const blocksEdge = addEdge(graph, edgeInput(a.node.id, b.node.id, { relation: "blocks", confidence: 0.2 }), 103);
    graph = blocksEdge.graph;

    const candidates = detectContradictionTrigger(graph, 0.8, 200);
    expect(candidates).toHaveLength(1);
    expect(new Set(candidates[0].relatedEdgeIds)).toEqual(new Set([causesEdge.edge.id, blocksEdge.edge.id]));
  });

  it("suppresses a contradiction when both edges are below the confidence threshold", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;
    const causesEdge = addEdge(graph, edgeInput(a.node.id, b.node.id, { relation: "causes", confidence: 0.3 }), 102);
    graph = causesEdge.graph;
    const blocksEdge = addEdge(graph, edgeInput(a.node.id, b.node.id, { relation: "blocks", confidence: 0.2 }), 103);
    graph = blocksEdge.graph;

    expect(detectContradictionTrigger(graph, 0.8, 200)).toEqual([]);
  });

  it("returns no candidates when there are no contradictions", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;
    const edge = addEdge(graph, edgeInput(a.node.id, b.node.id, { confidence: 0.9 }), 102);
    graph = edge.graph;

    expect(detectContradictionTrigger(graph, 0.8, 200)).toEqual([]);
  });
});
