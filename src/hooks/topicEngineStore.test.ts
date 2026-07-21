import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopicEngineStore } from "./topicEngineStore";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("topicEngineStore", () => {
  it("flushes the latest buffered speech into a segment", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTopicEngineStore();

    store.addTranscriptText("  今日は  ");
    store.addTranscriptText("レイテンシー対策を決めたいです ");
    store.flushBuffer();

    const snapshot = store.getSnapshot();
    expect(snapshot.bufferText).toBe("");
    expect(snapshot.engineState.segments[0]?.text).toBe("今日は レイテンシー対策を決めたいです");
    expect(snapshot.logs[0]?.type).toBe("decision");
    expect(snapshot.logs[1]?.type).toBe("speech");
  });

  it("applies manual focus and lock against the latest engine state", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);
    const store = createTopicEngineStore();

    store.submitTranscript("予算の件を決めます", "manual");
    const topicId = store.getSnapshot().engineState.currentTopicId;
    store.setManualFocus(topicId);
    store.setFocusLocked(true);

    const snapshot = store.getSnapshot();
    expect(snapshot.engineState.focusState.focusTopicId).toBe(topicId);
    expect(snapshot.engineState.focusState.focusSetBy).toBe("manual");
    expect(snapshot.engineState.focusState.locked).toBe(true);
    expect(snapshot.logs[0]?.message).toBe("focus locked");
  });

  it("attaches timed transcript metadata to the latest segment", () => {
    vi.spyOn(Date, "now").mockReturnValue(4_000);
    const store = createTopicEngineStore();

    store.submitTimedTranscript({
      id: "seg-1",
      startMs: 100,
      endMs: 300,
      speaker: "A",
      text: "認証フローの件を確認します",
      source: "official_transcript",
      confidence: 0.92,
    });

    const segment = store.getSnapshot().engineState.segments[0];
    expect(segment?.metadata).toMatchObject({
      startMs: 100,
      endMs: 300,
      speaker: "A",
      transcriptSource: "official_transcript",
      confidence: 0.92,
    });
  });

  it("resets engine state, buffer and logs together", () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const store = createTopicEngineStore();

    store.addTranscriptText("テスト");
    store.flushBuffer();
    expect(store.getSnapshot().logs.length).toBeGreaterThan(0);

    store.reset();

    const snapshot = store.getSnapshot();
    expect(snapshot.bufferText).toBe("");
    expect(snapshot.logs).toEqual([]);
    expect(snapshot.engineState.segments).toEqual([]);
    expect(snapshot.engineState.currentTopicId).toBeNull();
    expect(snapshot.conversationTree.nodes).toEqual([]);
  });

  it("builds, corrects and rates the live conversation hierarchy", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(5_000)
      .mockReturnValueOnce(6_000);
    const store = createTopicEngineStore();
    [
      "今日は採用フローの短縮について決めます",
      "候補者連絡の遅さが問題です",
      "理由は担当が曖昧だからです",
      "佐藤さんが金曜までに改善案を出します",
      "ただ、別案も見た方がいいです",
      "そうですね",
    ].forEach((text) => store.submitTranscript(text, "manual"));

    const nodes = store.getSnapshot().conversationTree.nodes;
    expect(nodes).toHaveLength(5);
    expect(nodes[4].parentId).toBe(nodes[2].id);
    store.toggleConversationNodeRating(nodes[4].id);
    expect(store.getSnapshot().conversationTree.nodes[4].rating).toBe(1);
    store.updateConversationNode(nodes[4].id, { role: "statement", parentId: nodes[1].id });
    expect(store.getSnapshot().conversationTree.nodes[4]).toMatchObject({
      role: "statement",
      parentId: nodes[1].id,
      manuallyAdjusted: true,
    });
  });

  it("creates a rule-based meeting summary and marks it stale when new speech arrives", async () => {
    vi.spyOn(Date, "now").mockReturnValue(6_000);
    const store = createTopicEngineStore();
    store.submitTranscript("採用フローの短縮を決めます", "manual");
    await store.organizeMeeting();
    expect(store.getSnapshot().meetingSummary?.topics.length).toBeGreaterThan(0);
    expect(store.getSnapshot().meetingSummaryStatus).toBe("rules");
    expect(store.getSnapshot().meetingSummaryStartedAt).toBe(6_000);

    store.submitTranscript("担当は田中さんです", "manual");
    expect(store.getSnapshot().meetingSummaryStale).toBe(true);
  });
});
