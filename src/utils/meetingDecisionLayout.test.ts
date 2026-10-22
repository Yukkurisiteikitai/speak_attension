import { describe, expect, it } from "vitest";
import type { MeetingDecisionGraph } from "../types/topic";
import { projectMeetingDecisionStep } from "./meetingDecisionLayout";

describe("decision step layout", () => {
  it.each(["短", "非常に長い日本語の根拠と担当者についての説明".repeat(30), "long-unbroken-label".repeat(100)])("keeps source previews bounded and nodes apart for %s", (label) => {
    const graph: MeetingDecisionGraph = {
      nodes: Array.from({ length: 10 }, (_, i) => ({ id: String(i), type: i ? "evidence" : "action", label, state: "human_stated", createdAt: 0, provenance: { utteranceIds: [], createdBy: "human" } })),
      edges: Array.from({ length: 9 }, (_, i) => ({ id: String(i), source: "0", target: String(i + 1), relation: "supports" })),
    };
    const { nodes, edges } = projectMeetingDecisionStep(graph, "0");
    expect(nodes).toHaveLength(10);
    expect(edges).toHaveLength(9);
    for (const a of nodes) {
      expect(String(a.data.label).length).toBeLessThan(90);
      for (const b of nodes.filter((n) => n.id !== a.id)) {
        expect(Math.abs(a.position.x - b.position.x) >= 280 || Math.abs(a.position.y - b.position.y) >= 140).toBe(true);
      }
    }
    expect(graph.nodes[0].label).toBe(label);
    expect(projectMeetingDecisionStep(graph, "missing")).toEqual({ nodes: [], edges: [] });
  });
});
