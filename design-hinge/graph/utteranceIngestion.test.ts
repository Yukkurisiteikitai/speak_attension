import { describe, expect, it } from "vitest";
import { createInitialHingeGraph } from "./graphEngine";
import { ingestUtteranceIntoGraph } from "./utteranceIngestion";

describe("ingestUtteranceIntoGraph", () => {
  it("proposes a new node pair and edge from a fresh graph", () => {
    const graph = createInitialHingeGraph("session-1");
    const result = ingestUtteranceIntoGraph(graph, "証拠がなければ告発できない", "seg-1", "policy_0.1", 100);

    expect(result.proposedNodes.map((n) => n.label)).toEqual(["証拠", "告発"]);
    expect(result.proposedEdges).toHaveLength(1);
    expect(result.proposedEdges[0]).toMatchObject({
      relation: "blocks",
      provenance: "human",
      evidenceType: "user_hypothesis",
      testStatus: "untested",
      scope: "this_work_only",
      confidence: 0.6,
    });
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
  });

  it("reuses an existing similar node instead of creating a duplicate", () => {
    const graph = createInitialHingeGraph("session-1");
    const first = ingestUtteranceIntoGraph(graph, "証拠がなければ告発できない", "seg-1", "policy_0.1", 100);
    const second = ingestUtteranceIntoGraph(first.graph, "証拠には証明が必要", "seg-2", "policy_0.1", 200);

    // "証拠" from seg-1 should be reused, not duplicated.
    const evidenceNodes = second.graph.nodes.filter((n) => n.label === "証拠");
    expect(evidenceNodes).toHaveLength(1);
    expect(second.proposedNodes.map((n) => n.label)).toEqual(["証明"]);
  });

  it("does not propose a duplicate edge for a repeated utterance", () => {
    const graph = createInitialHingeGraph("session-1");
    const first = ingestUtteranceIntoGraph(graph, "証拠がなければ告発できない", "seg-1", "policy_0.1", 100);
    const second = ingestUtteranceIntoGraph(first.graph, "証拠がなければ告発できない", "seg-2", "policy_0.1", 200);

    expect(second.proposedEdges).toHaveLength(0);
    expect(second.graph.edges).toHaveLength(1);
  });

  it("returns the input graph unchanged when the utterance has no causal markers", () => {
    const graph = createInitialHingeGraph("session-1");
    const result = ingestUtteranceIntoGraph(graph, "今日はいい天気ですね", "seg-1", "policy_0.1", 100);
    expect(result.graph).toBe(graph);
    expect(result.proposedNodes).toHaveLength(0);
    expect(result.proposedEdges).toHaveLength(0);
  });
});
