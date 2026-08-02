import { describe, expect, it } from "vitest";
import type { IdeaGroup, IdeaKeyword, IdeaPhase } from "../utils/ideaSession";
import { buildIdeaFlowElements, decisionLabel } from "./ideaFlow";

function keyword(id: string, groupId: string | null = null): IdeaKeyword {
  return {
    id,
    label: `キーワード${id}`,
    normalized: id,
    mentionCount: id === "k2" ? 2 : 1,
    utteranceIds: [`utterance-${id}`],
    firstMentionedAt: 0,
    groupId,
    decision: "hold",
  };
}

const groups: IdeaGroup[] = [{ id: "g1", title: "グループ1", keywordIds: ["k1", "k2"] }];
const keywords = [keyword("k1", "g1"), keyword("k2", "g1"), keyword("k3")];

function build(phase: IdeaPhase) {
  return buildIdeaFlowElements({ phase, title: "アイデア出し", groups, keywords });
}

describe("buildIdeaFlowElements", () => {
  it("connects every capture keyword directly to the center", () => {
    const flow = build("capture");

    expect(flow.nodes.map((node) => node.id)).toEqual(["idea-center", "k1", "k2", "k3"]);
    expect(flow.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["idea-center", "k1"],
      ["idea-center", "k2"],
      ["idea-center", "k3"],
    ]);
    expect(flow.nodes.find((node) => node.id === "k2")?.data.mentionCount).toBe(2);
  });

  it("builds the one-direction hierarchy without inventing an edge for an ungrouped keyword", () => {
    const flow = build("select");

    expect(flow.nodes.map((node) => node.id)).toEqual(["idea-center", "g1", "k1", "k2", "k3"]);
    expect(flow.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["idea-center", "g1"],
      ["g1", "k1"],
      ["g1", "k2"],
    ]);
    expect(flow.nodes.find((node) => node.id === "k1")?.data).toMatchObject({
      kind: "keyword",
      decision: "hold",
      phase: "select",
    });
    expect(flow.nodes.find((node) => node.id === "k3")?.data.color).toBeUndefined();
  });
});

describe("decisionLabel", () => {
  it.each([
    ["adopted", "採用"],
    ["hold", "保留"],
    ["rejected", "却下"],
  ] as const)("maps %s to its Japanese label", (decision, label) => {
    expect(decisionLabel(decision)).toBe(label);
  });
});
