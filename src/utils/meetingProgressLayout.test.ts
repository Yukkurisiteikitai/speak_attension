import { describe, expect, it } from "vitest";
import { projectMeetingProgress, categorizeProgressKind } from "./meetingProgressLayout";
import type { MeetingProgress } from "./meetingProgress";

describe("meeting progress layout", () => {
  describe("categorizeProgressKind", () => {
    it("categorizes topic kinds", () => {
      expect(categorizeProgressKind("会議")).toBe("topic");
      expect(categorizeProgressKind("議題")).toBe("topic");
    });

    it("categorizes issue kinds", () => {
      expect(categorizeProgressKind("課題")).toBe("issue");
      expect(categorizeProgressKind("質問")).toBe("issue");
      expect(categorizeProgressKind("次の問い")).toBe("issue");
    });

    it("prioritizes unconfirmed over base issue", () => {
      expect(categorizeProgressKind("課題・未確認")).toBe("unconfirmed");
    });

    it("categorizes reason kinds", () => {
      expect(categorizeProgressKind("理由")).toBe("reason");
      expect(categorizeProgressKind("根拠")).toBe("reason");
    });

    it("categorizes proposal kinds", () => {
      expect(categorizeProgressKind("提案")).toBe("proposal");
      expect(categorizeProgressKind("行動案")).toBe("proposal");
    });

    it("categorizes risk kinds", () => {
      expect(categorizeProgressKind("リスク")).toBe("risk");
      expect(categorizeProgressKind("懸念")).toBe("risk");
    });

    it("categorizes decision kinds", () => {
      expect(categorizeProgressKind("決定")).toBe("decision");
      expect(categorizeProgressKind("実行結果・更新")).toBe("decision");
      expect(categorizeProgressKind("実行結果")).toBe("decision");
      expect(categorizeProgressKind("回答を記録")).toBe("decision");
      expect(categorizeProgressKind("確認項目の更新")).toBe("decision");
    });

    it("categorizes action kinds", () => {
      expect(categorizeProgressKind("アクション")).toBe("action");
    });

    it("categorizes planned kinds", () => {
      expect(categorizeProgressKind("予定・条件付き")).toBe("planned");
      expect(categorizeProgressKind("後で検討")).toBe("planned");
    });

    it("returns neutral for unmatched kinds", () => {
      expect(categorizeProgressKind("発言・進行")).toBe("neutral");
      expect(categorizeProgressKind("unknown")).toBe("neutral");
    });
  });

  it.each(["短い案", "長い日本語の判断理由と追加確認の予定です".repeat(50), "unbrokenlabel".repeat(100)])("bounds previews and separates branches for %s", (label) => {
    const progress: MeetingProgress = { nodes: [{ id: "progress-root", parentId: null, kind: "会議", label, planned: false }], links: [], prompts: [] };
    for (let i = 0; i < 32; i++) progress.nodes.push({ id: `n-${i}`, parentId: i < 4 ? "progress-root" : `n-${Math.floor((i - 4) / 3)}`, label, kind: "予定・条件付き", planned: i > 15 });
    const { nodes, edges } = projectMeetingProgress(progress, true);
    expect(nodes).toHaveLength(33);
    expect(edges).toHaveLength(32);
    for (const a of nodes) {
      expect(String(a.data.label).length).toBeLessThan(90);
      for (const b of nodes.filter((node) => node.id !== a.id)) expect(Math.abs(a.position.x - b.position.x) >= 290 || Math.abs(a.position.y - b.position.y) >= 150).toBe(true);
    }
    expect(progress.nodes[0].label).toBe(label);
  });
});
