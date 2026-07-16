import { describe, expect, it } from "vitest";
import { applyTopicTitleRefinements, createInitialTopicEngineState, processTopicSegment } from "./topicEngine";

describe("topicEngine replay scenario", () => {
  it("builds a topic map and closes earlier topics after focus shift", () => {
    let state = createInitialTopicEngineState(0);

    state = processTopicSegment(state, "今日はレイテンシー対策を決めたいです", "replay", 0).state;
    const latencyTopicId = state.currentTopicId;
    expect(latencyTopicId).not.toBeNull();

    state = processTopicSegment(state, "レイテンシー対策の理由は待ち時間が長いからで、田中さんが来週までに対応する", "replay", 5_000).state;
    expect(state.currentTopicId).toBe(latencyTopicId);

    state = processTopicSegment(state, "次に予算の件を決めます", "replay", 10_000).state;
    const budgetTopicId = state.currentTopicId;
    expect(budgetTopicId).not.toBe(latencyTopicId);

    state = processTopicSegment(state, "予算案の比較を進める", "replay", 16_000).state;

    const latencyTopic = state.meetingGraph.nodes.find((node) => node.id === latencyTopicId);
    expect(latencyTopic?.closedAt).not.toBeNull();
    expect(state.meetingGraph.gaps.some((gap) => gap.topicId === latencyTopicId)).toBe(true);
    expect(state.meetingGraph.gapSummary.gaps.length).toBeGreaterThan(0);
  });

  it("keeps unresolved questions as unresolved topics", () => {
    let state = createInitialTopicEngineState(0);

    state = processTopicSegment(state, "認証フローの件ってどうしますか？", "manual", 0).state;
    const authTopicId = state.currentTopicId;
    state = processTopicSegment(state, "次に運用体制の見直しについて話します", "manual", 16_000).state;
    state = processTopicSegment(state, "運用体制の見直しで担当を決める", "manual", 22_000).state;
    state = processTopicSegment(state, "では採用広報の見出しを確認する", "manual", 30_000).state;

    const authTopic = state.meetingGraph.nodes.find((node) => node.id === authTopicId);
    expect(authTopic?.displayStates).toContain("unresolved");
  });
});

describe("applyTopicTitleRefinements", () => {
  it("returns same state when updates are empty", () => {
    const state = createInitialTopicEngineState(0);
    const updates = new Map<string, string>();

    const result = applyTopicTitleRefinements(state, updates);
    expect(result).toBe(state);
  });

  it("updates only target topics", () => {
    let state = createInitialTopicEngineState(0);
    state = processTopicSegment(state, "レイテンシー対策を決める", "manual", 0).state;
    const topicId1 = state.currentTopicId!;

    state = processTopicSegment(state, "次に予算について話します", "manual", 5_000).state;
    const topicId2 = state.currentTopicId!;

    const originalTopic1 = state.meetingGraph.nodes.find((n) => n.id === topicId1)!;
    const originalTitle1 = originalTopic1.title;

    const updates = new Map([[topicId1, "新しいタイトル1"]]);
    const result = applyTopicTitleRefinements(state, updates);

    const updatedTopic1 = result.meetingGraph.nodes.find((n) => n.id === topicId1)!;
    const unchangedTopic2 = result.meetingGraph.nodes.find((n) => n.id === topicId2)!;

    expect(updatedTopic1.title).toBe("新しいタイトル1");
    expect(unchangedTopic2.title).toContain("予算");
  });

  it("preserves old title in aliases", () => {
    let state = createInitialTopicEngineState(0);
    state = processTopicSegment(state, "レイテンシー対策を決める", "manual", 0).state;
    const topicId = state.currentTopicId!;

    const originalTopic = state.meetingGraph.nodes.find((n) => n.id === topicId)!;
    const originalTitle = originalTopic.title;

    const updates = new Map([[topicId, "新しいタイトル"]]);
    const result = applyTopicTitleRefinements(state, updates);

    const updatedTopic = result.meetingGraph.nodes.find((n) => n.id === topicId)!;
    const normalizedOldTitle = originalTitle.toLowerCase().replace(/[「」『』（）()【】［］.,、。!?！？]/g, " ").replace(/\s+/g, " ").trim();
    const hasOldTitleInAliases = updatedTopic.aliases.some((alias) => alias.includes(normalizedOldTitle.split(" ")[0]));

    expect(hasOldTitleInAliases).toBe(true);
  });

  it("respects alias length limit", () => {
    let state = createInitialTopicEngineState(0);
    state = processTopicSegment(state, "レイテンシー対策を決める", "manual", 0).state;
    const topicId = state.currentTopicId!;

    const originalTopic = state.meetingGraph.nodes.find((n) => n.id === topicId)!;
    // Add many aliases to reach the limit
    const updatedWithManyAliases = {
      ...originalTopic,
      aliases: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    };

    state = {
      ...state,
      meetingGraph: {
        ...state.meetingGraph,
        nodes: state.meetingGraph.nodes.map((n) => (n.id === topicId ? updatedWithManyAliases : n)),
      },
    };

    const updates = new Map([[topicId, "新しいタイトル"]]);
    const result = applyTopicTitleRefinements(state, updates);

    const updatedTopic = result.meetingGraph.nodes.find((n) => n.id === topicId)!;
    expect(updatedTopic.aliases.length).toBeLessThanOrEqual(8);
  });

  it("updates focusLabel when focused topic is updated", () => {
    let state = createInitialTopicEngineState(0);
    state = processTopicSegment(state, "レイテンシー対策を決める", "manual", 0).state;
    const topicId = state.currentTopicId!;

    state = {
      ...state,
      focusState: {
        ...state.focusState,
        focusTopicId: topicId,
        focusLabel: "旧ラベル",
      },
    };

    const updates = new Map([[topicId, "新しいタイトル"]]);
    const result = applyTopicTitleRefinements(state, updates);

    expect(result.focusState.focusLabel).toBe("新しいタイトル");
  });

  it("preserves focusLabel when focused topic is not updated", () => {
    let state = createInitialTopicEngineState(0);
    state = processTopicSegment(state, "レイテンシー対策を決める", "manual", 0).state;
    const topicId1 = state.currentTopicId!;

    state = processTopicSegment(state, "次に予算について話します", "manual", 5_000).state;
    const topicId2 = state.currentTopicId!;

    state = {
      ...state,
      focusState: {
        ...state.focusState,
        focusTopicId: topicId2,
        focusLabel: "予算",
      },
    };

    const updates = new Map([[topicId1, "新しいタイトル1"]]);
    const result = applyTopicTitleRefinements(state, updates);

    expect(result.focusState.focusLabel).toBe("予算");
  });

  it("re-projects nodes and edges after title update", () => {
    let state = createInitialTopicEngineState(0);
    state = processTopicSegment(state, "レイテンシー対策を決める", "manual", 0).state;
    const topicId = state.currentTopicId!;

    const originalNodeCount = state.nodes.length;
    const originalEdgeCount = state.edges.length;

    const updates = new Map([[topicId, "新しいタイトル"]]);
    const result = applyTopicTitleRefinements(state, updates);

    // Projection is recreated after update
    expect(result.nodes.length).toBe(originalNodeCount);
    expect(result.edges.length).toBe(originalEdgeCount);
  });
});
