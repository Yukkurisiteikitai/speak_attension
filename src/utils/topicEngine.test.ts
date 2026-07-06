import { describe, expect, it } from "vitest";
import { createInitialTopicEngineState, processTopicSegment } from "./topicEngine";

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
