import { describe, expect, it } from "vitest";
import { addNode, createInitialHingeGraph } from "../graph/graphEngine";
import type { NewHingeNodeInput } from "../graph/types";
import { buildTemplateQuestion } from "./phraseTemplates";
import type { InterventionCandidate } from "./types";

function nodeInput(label: string, overrides: Partial<NewHingeNodeInput> = {}): NewHingeNodeInput {
  return {
    type: "custom", label, content: label, origin: "human", confidence: 1,
    sourceSegmentId: null, policyVersion: "policy_0.1", ...overrides,
  };
}

function candidate(overrides: Partial<InterventionCandidate>): InterventionCandidate {
  return {
    id: "cand-1", triggerType: "silence", createdAtMs: 100, reasonCode: "silence",
    reasonSummary: "", relatedNodeIds: [], relatedEdgeIds: [], confidence: 0.6, form: "question",
    ...overrides,
  };
}

describe("buildTemplateQuestion", () => {
  it("phrases an isolated-node graph_gap candidate by name", () => {
    let graph = createInitialHingeGraph("s");
    const node = addNode(graph, nodeInput("孤立したアイデア"), 100);
    graph = node.graph;

    const text = buildTemplateQuestion(
      candidate({ triggerType: "graph_gap", reasonCode: `isolated_node:${node.node.id}`, relatedNodeIds: [node.node.id] }),
      graph,
    );
    expect(text).toContain("孤立したアイデア");
    expect(text).toContain("因果関係がありません");
  });

  it("phrases a low-confidence-edge graph_gap candidate naming both ends", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;

    const text = buildTemplateQuestion(
      candidate({ triggerType: "graph_gap", reasonCode: "low_confidence_edge:e1", relatedNodeIds: [a.node.id, b.node.id] }),
      graph,
    );
    expect(text).toContain("A");
    expect(text).toContain("B");
  });

  it("phrases a contradiction candidate naming both ends", () => {
    let graph = createInitialHingeGraph("s");
    const a = addNode(graph, nodeInput("A"), 100);
    graph = a.graph;
    const b = addNode(graph, nodeInput("B"), 101);
    graph = b.graph;

    const text = buildTemplateQuestion(candidate({ triggerType: "contradiction", relatedNodeIds: [a.node.id, b.node.id] }), graph);
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("矛盾");
  });

  it("phrases silence, stagnation, counterfactual, and manual with stable generic text", () => {
    const graph = createInitialHingeGraph("s");
    expect(buildTemplateQuestion(candidate({ triggerType: "silence" }), graph)).toContain("聞かせてください");
    expect(buildTemplateQuestion(candidate({ triggerType: "stagnation" }), graph)).toContain("角度");
    expect(buildTemplateQuestion(candidate({ triggerType: "manual" }), graph)).toContain("深掘り");
  });
});
