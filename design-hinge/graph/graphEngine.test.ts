import { describe, expect, it } from "vitest";
import { addEdge, addNode, createInitialHingeGraph, removeEdge, removeNode, updateEdgeConfidence, updateEdgeTestStatus } from "./graphEngine";
import type { NewHingeEdgeInput, NewHingeNodeInput } from "./types";

function nodeInput(label: string, overrides: Partial<NewHingeNodeInput> = {}): NewHingeNodeInput {
  return {
    type: "custom",
    label,
    content: label,
    origin: "human",
    confidence: 1,
    sourceSegmentId: null,
    policyVersion: "policy_0.1",
    ...overrides,
  };
}

function edgeInput(source: string, target: string, overrides: Partial<NewHingeEdgeInput> = {}): NewHingeEdgeInput {
  return {
    source,
    target,
    relation: "causes",
    confidence: 0.6,
    evidenceType: "user_hypothesis",
    provenance: "human",
    testStatus: "untested",
    scope: "this_work_only",
    ...overrides,
  };
}

describe("graphEngine", () => {
  it("adds nodes and edges immutably", () => {
    const empty = createInitialHingeGraph("session-1");
    const { graph: g1, node: rule } = addNode(empty, nodeInput("容疑者は調査できない", { type: "rule" }), 100);
    const { graph: g2, node: action } = addNode(g1, nodeInput("一次情報の欠落", { type: "action" }), 101);
    const { graph: g3, edge } = addEdge(g2, edgeInput(rule.id, action.id), 102);

    expect(empty.nodes).toHaveLength(0);
    expect(g1.nodes).toHaveLength(1);
    expect(g3.nodes).toHaveLength(2);
    expect(g3.edges).toEqual([edge]);
    expect(edge.source).toBe(rule.id);
    expect(edge.target).toBe(action.id);
  });

  it("throws when adding an edge to a missing node", () => {
    const graph = createInitialHingeGraph("session-1");
    const { graph: withNode, node } = addNode(graph, nodeInput("容疑者は調査できない"), 100);
    expect(() => addEdge(withNode, edgeInput(node.id, "missing-node"), 101)).toThrow();
  });

  it("updates edge test status and confidence without touching other fields", () => {
    let graph = createInitialHingeGraph("session-1");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;
    const e = addEdge(graph, edgeInput(a.node.id, b.node.id), 102);
    graph = e.graph;

    graph = updateEdgeTestStatus(graph, e.edge.id, "supported");
    graph = updateEdgeConfidence(graph, e.edge.id, 0.9);

    const updated = graph.edges.find((edge) => edge.id === e.edge.id)!;
    expect(updated.testStatus).toBe("supported");
    expect(updated.confidence).toBe(0.9);
    expect(updated.relation).toBe("causes");
  });

  it("cascades edge removal when a node is removed", () => {
    let graph = createInitialHingeGraph("session-1");
    const a = addNode(graph, nodeInput("A"));
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"));
    graph = b.graph;
    const e = addEdge(graph, edgeInput(a.node.id, b.node.id));
    graph = e.graph;

    graph = removeNode(graph, a.node.id);

    expect(graph.nodes.map((n) => n.id)).toEqual([b.node.id]);
    expect(graph.edges).toHaveLength(0);
  });

  it("removes a single edge without touching nodes", () => {
    let graph = createInitialHingeGraph("session-1");
    const a = addNode(graph, nodeInput("A"));
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"));
    graph = b.graph;
    const e = addEdge(graph, edgeInput(a.node.id, b.node.id));
    graph = e.graph;

    graph = removeEdge(graph, e.edge.id);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(0);
  });
});
