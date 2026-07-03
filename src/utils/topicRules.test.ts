import { describe, expect, it } from "vitest";
import { INITIAL_TOPIC_NODES, findMatchedKeywords, scoreTopic } from "./topicRules";

describe("topicRules", () => {
  it("scores topic nodes by matched keywords", () => {
    const graphNode = INITIAL_TOPIC_NODES.find((node) => node.id === "graph");
    expect(graphNode).toBeDefined();
    expect(scoreTopic("React Flowのノードとエッジを描画します", graphNode!)).toBe(4);
  });

  it("returns matched keywords for decision logs", () => {
    const uiNode = INITIAL_TOPIC_NODES.find((node) => node.id === "ui");
    expect(uiNode).toBeDefined();
    expect(findMatchedKeywords("画面で強調してLive感を出したい", uiNode!)).toEqual(["画面", "Live感", "強調"]);
  });
});
