import { describe, expect, it } from "vitest";
import type { ConversationGraphNodeData, ConversationNodeRole, ConversationTreeNode } from "../types/topic";
import {
  CONVERSATION_NODE_WIDTH,
  CONVERSATION_ROOT_WIDTH,
  estimateConversationNodeHeight,
  projectConversationTreeToFlow,
} from "./conversationTreeLayout";

function node(id: string, parentId: string | null, role: ConversationNodeRole, label: string, createdAt: number): ConversationTreeNode {
  return { id, parentId, role, label, createdAt, segmentId: `seg-${id}`, originalText: label, source: "manual", rating: 0, manuallyAdjusted: false };
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("conversation tree layout", () => {
  it("places an arbitrary-depth tree left to right without overlaps", () => {
    const tree = {
      activeTopicNodeId: "topic-a",
      nodes: [
        node("topic-a", null, "topic", "採用フローの短縮", 1),
        node("issue-a", "topic-a", "issue", "候補者連絡の遅さが問題", 2),
        node("cause-a", "issue-a", "cause", "担当が曖昧", 3),
        node("action-a", "cause-a", "action", "佐藤さんが金曜までに改善案を出します", 4),
        node("alternative-a", "cause-a", "alternative", "別案も見た方がいいです", 5),
        node("topic-b", null, "topic", "非常に長い日本語の第二議題について検討するための表示確認", 6),
        node("issue-b", "topic-b", "issue", "オフライン環境で候補者情報を確認できない問題が発生している", 7),
      ],
    };
    const result = projectConversationTreeToFlow(tree);
    const byId = new Map(result.nodes.map((item) => [item.id, item]));
    for (const edge of result.edges) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      const sourceWidth = source.data.role === "root" ? CONVERSATION_ROOT_WIDTH : CONVERSATION_NODE_WIDTH;
      expect(target.position.x).toBeGreaterThan(source.position.x + sourceWidth);
    }
    const rects = result.nodes.map((item) => ({
      ...item.position,
      width: item.data.role === "root" ? CONVERSATION_ROOT_WIDTH : CONVERSATION_NODE_WIDTH,
      height: estimateConversationNodeHeight(item.data as ConversationGraphNodeData),
    }));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) expect(overlaps(rects[i], rects[j])).toBe(false);
    }
  });

  it("is deterministic", () => {
    const tree = { activeTopicNodeId: "t", nodes: [node("t", null, "topic", "議題", 1), node("i", "t", "issue", "課題", 2)] };
    expect(projectConversationTreeToFlow(tree)).toEqual(projectConversationTreeToFlow(tree));
  });
});
