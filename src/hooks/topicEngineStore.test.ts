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

  it("flushes on silence so a final utterance is not held for the full buffer window", () => {
    // ADR 0023 §7: a final transcript enters the fast path on the next quiet
    // tick, not on a fixed 5s interval.
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const store = createTopicEngineStore();

    store.addTranscriptText("レイテンシー対策を決めたいです");
    now = 1_400; // 400ms of silence: below the idle threshold
    store.flushIfIdle(800, 5_000);
    expect(store.getSnapshot().engineState.segments).toHaveLength(0);
    expect(store.getSnapshot().bufferText).toBe("レイテンシー対策を決めたいです");

    now = 1_900; // 900ms of silence: flush
    store.flushIfIdle(800, 5_000);
    const snapshot = store.getSnapshot();
    expect(snapshot.bufferText).toBe("");
    expect(snapshot.engineState.segments[0]?.text).toBe("レイテンシー対策を決めたいです");
  });

  it("keeps merging while speech continues, then flushes as one segment", () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const store = createTopicEngineStore();

    store.addTranscriptText("今日は");
    now = 1_300;
    store.flushIfIdle(800, 5_000);
    now = 1_500;
    store.addTranscriptText("レイテンシー対策を決めたいです");
    now = 2_400;
    store.flushIfIdle(800, 5_000);

    const snapshot = store.getSnapshot();
    expect(snapshot.engineState.segments).toHaveLength(1);
    expect(snapshot.engineState.segments[0]?.text).toBe("今日は レイテンシー対策を決めたいです");
  });

  it("flushes at the backstop even when speech never pauses", () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const store = createTopicEngineStore();

    for (let step = 0; step < 12; step += 1) {
      store.addTranscriptText(`区切りのない発話${step}`);
      now += 500; // always shorter than the idle threshold
      store.flushIfIdle(800, 5_000);
    }

    expect(store.getSnapshot().engineState.segments.length).toBeGreaterThan(0);
  });

  it("flushes immediately on explicit terminal punctuation", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTopicEngineStore();

    store.addTranscriptText("レイテンシー対策を決めます。");

    const snapshot = store.getSnapshot();
    expect(snapshot.bufferText).toBe("");
    expect(snapshot.engineState.segments[0]?.text).toBe("レイテンシー対策を決めます。");
  });

  it("does not split a polite verb ending into its own segment", () => {
    // Web Speech emits mid-sentence final chunks; splitting on です/ます would
    // fragment one utterance across segments.
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTopicEngineStore();

    store.addTranscriptText("対応します");

    expect(store.getSnapshot().engineState.segments).toHaveLength(0);
    expect(store.getSnapshot().bufferText).toBe("対応します");
  });

  it("flushIfIdle does nothing when the buffer is empty", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTopicEngineStore();

    store.flushIfIdle(0, 0);

    expect(store.getSnapshot().engineState.segments).toHaveLength(0);
    expect(store.getSnapshot().logs).toHaveLength(0);
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

  it("only creates decision materials on an explicit manual analysis and preserves processed status", () => {
    const store = createTopicEngineStore();
    store.submitTranscript("金曜日に公開したいです", "manual");
    store.submitTranscript("不具合が怖いです", "manual");
    expect(store.getSnapshot().decisionSupport.status).toBe("idle");
    store.analyzeDecisionSupport();
    const material = store.getSnapshot().decisionSupport.materials[0];
    expect(material?.sourceEvidenceSegmentIds).toHaveLength(2);
    store.updateDecisionMaterialStatus(material!.id, "checked");
    store.analyzeDecisionSupport();
    expect(store.getSnapshot().decisionSupport.materials[0]?.status).toBe("checked");
  });
});
