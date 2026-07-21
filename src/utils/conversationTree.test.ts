import { describe, expect, it } from "vitest";
import type { AnalyzedSegment } from "../types/topic";
import {
  appendConversationSegment,
  createInitialConversationTreeState,
  toggleConversationNodeRating,
  updateConversationNode,
} from "./conversationTree";

function segment(id: string, text: string, createdAt: number): AnalyzedSegment {
  return {
    id,
    text,
    createdAt,
    source: "replay",
    matchedTopicIds: [],
    analysis: {} as AnalyzedSegment["analysis"],
  };
}

function buildExample() {
  const lines = [
    "今日は採用フローの短縮について決めます",
    "候補者連絡の遅さが問題です",
    "理由は担当が曖昧だからです",
    "佐藤さんが金曜までに改善案を出します",
    "ただ、別案も見た方がいいです",
    "そうですね",
  ];
  return lines.reduce(
    (state, text, index) => appendConversationSegment(state, segment(`seg-${index + 1}`, text, index + 1)),
    createInitialConversationTreeState(),
  );
}

describe("conversation tree", () => {
  it("builds the requested topic → issue → cause → action/alternative hierarchy and ignores fillers", () => {
    const state = buildExample();
    expect(state.nodes.map(({ label, role }) => ({ label, role }))).toEqual([
      { label: "採用フローの短縮", role: "topic" },
      { label: "候補者連絡の遅さが問題", role: "issue" },
      { label: "担当が曖昧", role: "cause" },
      { label: "佐藤さんが金曜までに改善案を出します", role: "action" },
      { label: "別案も見た方がいいです", role: "alternative" },
    ]);
    expect(state.nodes[1].parentId).toBe(state.nodes[0].id);
    expect(state.nodes[2].parentId).toBe(state.nodes[1].id);
    expect(state.nodes[3].parentId).toBe(state.nodes[2].id);
    expect(state.nodes[4].parentId).toBe(state.nodes[2].id);
  });

  it("falls back to the active topic and starts a parallel topic after a switch", () => {
    let state = createInitialConversationTreeState();
    state = appendConversationSegment(state, segment("a", "採用フローについて話します", 1));
    state = appendConversationSegment(state, segment("b", "来週までに対応します", 2));
    state = appendConversationSegment(state, segment("c", "次に予算について話します", 3));
    state = appendConversationSegment(state, segment("d", "コストが問題です", 4));
    expect(state.nodes[1].parentId).toBe(state.nodes[0].id);
    expect(state.nodes[2].parentId).toBeNull();
    expect(state.nodes[3].parentId).toBe(state.nodes[2].id);
  });

  it("closes a topic on meeting-end phrases and starts the next conversation as a parallel topic", () => {
    const lines = [
      "今日は採用フローの短縮について決めます",
      "まず現状を整理したいです",
      "今日はここまでです",
      "新機能のリリース時期を決めたいです",
      "開発状況を共有します",
      "以上で終わります",
      "今日は障害対応を振り返ります",
      "昨日の夜にサーバーが停止しました",
      "以上です",
      "営業目標について確認します",
      "数字は来週まとめます",
      "今日は以上です",
      "今日はデザインレビューです",
      "ホーム画面を中心に確認します",
    ];
    const state = lines.reduce(
      (current, text, index) => appendConversationSegment(current, segment(`boundary-${index}`, text, index)),
      createInitialConversationTreeState(),
    );
    const rootTopics = state.nodes.filter((item) => item.parentId === null);
    expect(rootTopics.map((item) => item.label)).toEqual([
      "採用フローの短縮",
      "新機能のリリース時期",
      "障害対応",
      "営業目標",
      "デザインレビュー",
    ]);
    expect(state.nodes.some((item) => /ここまで|以上/.test(item.label))).toBe(false);
  });

  it("recognizes explicit topic openings even without a prior closing phrase", () => {
    let state = createInitialConversationTreeState();
    state = appendConversationSegment(state, segment("topic-1", "品質改善について話します", 1));
    state = appendConversationSegment(state, segment("topic-2", "今日はAI導入について議論します", 2));
    expect(state.nodes.map((item) => ({ label: item.label, parentId: item.parentId }))).toEqual([
      { label: "品質改善", parentId: null },
      { label: "AI導入", parentId: null },
    ]);
  });

  it("toggles ratings and rejects invalid parent changes", () => {
    const state = buildExample();
    const alternative = state.nodes[4];
    const rated = toggleConversationNodeRating(state, alternative.id);
    expect(rated.nodes[4].rating).toBe(1);
    expect(toggleConversationNodeRating(rated, alternative.id).nodes[4].rating).toBe(0);
    expect(updateConversationNode(state, state.nodes[1].id, { parentId: state.nodes[4].id })).toBe(state);
    expect(updateConversationNode(state, state.nodes[1].id, { parentId: "missing" })).toBe(state);
  });

  it("allows a role and earlier-parent correction and records it", () => {
    const state = buildExample();
    const corrected = updateConversationNode(state, state.nodes[4].id, {
      role: "statement",
      parentId: state.nodes[1].id,
    });
    expect(corrected.nodes[4]).toMatchObject({
      role: "statement",
      parentId: state.nodes[1].id,
      manuallyAdjusted: true,
    });
  });
});
