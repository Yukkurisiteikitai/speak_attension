import { describe, expect, it } from "vitest";
import { addEdge, addNode, createInitialHingeGraph } from "./graphEngine";
import { computeCounterfactualEdgeRemoval, computeCounterfactualNodeRemoval, markCounterfactualSensitivity } from "./graphDiff";
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
    confidence: 0.8,
    evidenceType: "direct_rule",
    provenance: "human",
    testStatus: "supported",
    scope: "this_work_only",
    ...overrides,
  };
}

// deep_research.md's 容疑者 worked example (line 79): "容疑者は調査できない"
// causes a chain of downstream effects: 一次情報の欠落 -> 他者への依存 ->
// 信用管理 -> 発言反応からの情報抽出. This mirrors the doc's D1-D3 ablation
// reasoning: removing the root rule should make the entire downstream chain
// unreachable.
function buildSuspectChainFixture() {
  let graph = createInitialHingeGraph("session-d0d3");
  const rule = addNode(graph, nodeInput("容疑者は調査できない", { type: "rule" }));
  graph = rule.graph;
  const infoGap = addNode(graph, nodeInput("一次情報の欠落", { type: "info_topology" }));
  graph = infoGap.graph;
  const dependency = addNode(graph, nodeInput("他者への依存", { type: "cognitive_challenge" }));
  graph = dependency.graph;
  const trustMgmt = addNode(graph, nodeInput("信用管理", { type: "strategy" }));
  graph = trustMgmt.graph;
  const extraction = addNode(graph, nodeInput("発言反応からの情報抽出", { type: "social_trust" }));
  graph = extraction.graph;

  // An independent, unrelated root+node pair, to prove the diff doesn't
  // over-report nodes that were never downstream of the removed element.
  const unrelatedRoot = addNode(graph, nodeInput("天気の話題", { type: "custom" }));
  graph = unrelatedRoot.graph;
  const unrelatedLeaf = addNode(graph, nodeInput("傘を持っていく", { type: "custom" }));
  graph = unrelatedLeaf.graph;

  const e1 = addEdge(graph, edgeInput(rule.node.id, infoGap.node.id));
  graph = e1.graph;
  const e2 = addEdge(graph, edgeInput(infoGap.node.id, dependency.node.id));
  graph = e2.graph;
  const e3 = addEdge(graph, edgeInput(dependency.node.id, trustMgmt.node.id));
  graph = e3.graph;
  const e4 = addEdge(graph, edgeInput(trustMgmt.node.id, extraction.node.id));
  graph = e4.graph;
  const eUnrelated = addEdge(graph, edgeInput(unrelatedRoot.node.id, unrelatedLeaf.node.id));
  graph = eUnrelated.graph;

  return {
    graph,
    rule: rule.node,
    infoGap: infoGap.node,
    dependency: dependency.node,
    trustMgmt: trustMgmt.node,
    extraction: extraction.node,
    unrelatedRoot: unrelatedRoot.node,
    unrelatedLeaf: unrelatedLeaf.node,
    edges: { e1: e1.edge, e2: e2.edge, e3: e3.edge, e4: e4.edge, eUnrelated: eUnrelated.edge },
  };
}

describe("graphDiff", () => {
  it("D1-style: removing the root rule makes the whole downstream chain unreachable, but not unrelated nodes", () => {
    const fixture = buildSuspectChainFixture();
    const diff = computeCounterfactualNodeRemoval(fixture.graph, fixture.rule.id);

    expect(new Set(diff.affectedNodeIds)).toEqual(
      new Set([fixture.infoGap.id, fixture.dependency.id, fixture.trustMgmt.id, fixture.extraction.id]),
    );
    expect(diff.affectedNodeIds).not.toContain(fixture.unrelatedRoot.id);
    expect(diff.affectedNodeIds).not.toContain(fixture.unrelatedLeaf.id);
    expect(diff.brokenEdges.map((e) => e.id)).toEqual([fixture.edges.e1.id]);
    expect(diff.summary).toContain("容疑者は調査できない");
  });

  it("D2-style: removing a middle link only affects the link's target and what's downstream of it", () => {
    const fixture = buildSuspectChainFixture();
    const diff = computeCounterfactualEdgeRemoval(fixture.graph, fixture.edges.e2.id);

    // "他者への依存" (the edge's target) becomes unreachable too, since it had
    // no other incoming edge — plus everything downstream of it.
    expect(new Set(diff.affectedNodeIds)).toEqual(
      new Set([fixture.dependency.id, fixture.trustMgmt.id, fixture.extraction.id]),
    );
    // The rule and info-gap nodes stay reachable — they're upstream of the
    // severed link, matching "何が原因かを切り分ける" intent.
    expect(diff.affectedNodeIds).not.toContain(fixture.rule.id);
    expect(diff.affectedNodeIds).not.toContain(fixture.infoGap.id);
  });

  it("reports no affected nodes when removing a leaf with no further downstream", () => {
    const fixture = buildSuspectChainFixture();
    const diff = computeCounterfactualNodeRemoval(fixture.graph, fixture.extraction.id);
    expect(diff.affectedNodeIds).toEqual([]);
    expect(diff.summary).toContain("影響しません");
  });

  it("handles an unknown id gracefully instead of throwing", () => {
    const fixture = buildSuspectChainFixture();
    const diff = computeCounterfactualNodeRemoval(fixture.graph, "missing-node");
    expect(diff.affectedNodeIds).toEqual([]);
    expect(diff.summary).toContain("見つかりませんでした");
  });

  it("marks chain edges as counterfactual-sensitive and the unrelated edge too (it's also load-bearing for its own leaf)", () => {
    const fixture = buildSuspectChainFixture();
    const marked = markCounterfactualSensitivity(fixture.graph);
    const byId = new Map(marked.edges.map((edge) => [edge.id, edge]));

    expect(byId.get(fixture.edges.e1.id)?.counterfactual).toBe(true);
    expect(byId.get(fixture.edges.e4.id)?.counterfactual).toBe(true);
    expect(byId.get(fixture.edges.eUnrelated.id)?.counterfactual).toBe(true);
  });
});
