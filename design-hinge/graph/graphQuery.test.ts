import { describe, expect, it } from "vitest";
import { addEdge, addNode, createInitialHingeGraph } from "./graphEngine";
import {
  findContradictingEdgePairs,
  findIsolatedNodes,
  findLongestSupportedPath,
  findLowConfidenceEdges,
  traverseNHops,
} from "./graphQuery";
import type { HingeGraph, NewHingeEdgeInput, NewHingeNodeInput } from "./types";

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

// Builds deep_research.md's own standard causal chain mermaid diagram, including
// its cycle (C -> J -> E, F -> C), plus one isolated node K.
// A[ルール] -> B[行動] -> C[情報トポロジー] -> D[目的] -> E[認知課題] -> F[戦略]
//   -> G[信用] -> H[感情的報酬] -> I[物語]
// C -> J[不確実性] -> E
// F -> C
function buildMermaidChainFixture() {
  let graph = createInitialHingeGraph("session-mermaid");
  const labels: Record<string, string> = {
    A: "ルール・役割・条件の変更",
    B: "可能な行動",
    C: "情報トポロジー",
    D: "目的・失敗条件",
    E: "支配的な認知課題",
    F: "有効な戦略",
    G: "社会関係・信用",
    H: "感情的報酬",
    I: "物語・人物・演出",
    J: "不確実性",
    K: "孤立した思いつき",
  };
  const ids: Record<string, string> = {};
  let now = 0;
  for (const [key, label] of Object.entries(labels)) {
    const result = addNode(graph, nodeInput(label), now);
    graph = result.graph;
    ids[key] = result.node.id;
    now += 1;
  }

  const chainEdges: Array<[string, string]> = [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "E"],
    ["E", "F"],
    ["F", "G"],
    ["G", "H"],
    ["H", "I"],
    ["C", "J"],
    ["J", "E"],
    ["F", "C"],
  ];
  for (const [from, to] of chainEdges) {
    const result = addEdge(graph, edgeInput(ids[from], ids[to]), now);
    graph = result.graph;
    now += 1;
  }

  return { graph, ids };
}

describe("graphQuery", () => {
  it("finds the isolated node and nothing else", () => {
    const { graph, ids } = buildMermaidChainFixture();
    const isolated = findIsolatedNodes(graph);
    expect(isolated.map((n) => n.id)).toEqual([ids.K]);
  });

  it("terminates traverseNHops despite the C -> J -> E -> F -> C cycle", () => {
    const { graph, ids } = buildMermaidChainFixture();
    const result = traverseNHops(graph, ids.A, 10);
    // No infinite loop, no duplicate nodes.
    const idSet = new Set(result.nodes.map((n) => n.id));
    expect(idSet.size).toBe(result.nodes.length);
    expect(idSet.has(ids.A)).toBe(true);
    expect(idSet.has(ids.K)).toBe(false); // isolated node unreachable
  });

  it("caps traversal at the requested hop count", () => {
    const { graph, ids } = buildMermaidChainFixture();
    const oneHop = traverseNHops(graph, ids.A, 1);
    expect(oneHop.nodes.map((n) => n.id).sort()).toEqual([ids.A, ids.B].sort());
  });

  it("finds low-confidence edges under a threshold", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"));
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"));
    graph = b.graph;
    const lowConf = addEdge(graph, edgeInput(a.node.id, b.node.id, { confidence: 0.2 }));
    graph = lowConf.graph;
    const highConf = addEdge(graph, edgeInput(b.node.id, a.node.id, { confidence: 0.9 }));
    graph = highConf.graph;

    const found = findLowConfidenceEdges(graph, 0.5);
    expect(found.map((e) => e.id)).toEqual([lowConf.edge.id]);
  });

  it("finds contradicting edge pairs between the same node pair", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("嘘をつく"));
    graph = a.graph;
    const b = addNode(graph, nodeInput("信頼を失う"));
    graph = b.graph;
    const causesEdge = addEdge(graph, edgeInput(a.node.id, b.node.id, { relation: "causes" }));
    graph = causesEdge.graph;
    const blocksEdge = addEdge(graph, edgeInput(a.node.id, b.node.id, { relation: "blocks" }));
    graph = blocksEdge.graph;

    const pairs = findContradictingEdgePairs(graph);
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].a.id, pairs[0].b.id])).toEqual(new Set([causesEdge.edge.id, blocksEdge.edge.id]));
  });

  it("finds the longest supported path, ignoring untested edges", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"));
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"));
    graph = b.graph;
    const c = addNode(graph, nodeInput("C"));
    graph = c.graph;
    const supported1 = addEdge(graph, edgeInput(a.node.id, b.node.id, { testStatus: "supported" }));
    graph = supported1.graph;
    const untested = addEdge(graph, edgeInput(b.node.id, c.node.id, { testStatus: "untested" }));
    graph = untested.graph;

    const path = findLongestSupportedPath(graph, a.node.id, 5);
    expect(path.map((n) => n.id)).toEqual([a.node.id, b.node.id]);
  });

  it("returns an empty graph when starting from an unknown node", () => {
    const { graph } = buildMermaidChainFixture();
    const result: HingeGraph = traverseNHops(graph, "missing-node");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
