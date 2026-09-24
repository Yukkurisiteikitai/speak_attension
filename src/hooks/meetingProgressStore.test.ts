import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopicEngineStore } from "./topicEngineStore";
import { DEFAULT_LLM_SETTINGS } from "../utils/llmClient";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const prepare = () => {
  const store = createTopicEngineStore();
  store.submitTranscript("資料を作成しましょう", "manual");
  store.setLlmSettings({ ...DEFAULT_LLM_SETTINGS, model: "local-model" });
  store.setMeetingReview({ phase: "review", deadline: Date.now() + 600_000, confirmations: ["", "", ""] });
  return store;
};
const response = (prompts: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ prompts }) } }] }), { status: 200 });

describe("explicit meeting review store", () => {
  it("does not request guidance during discussion or the final two minutes", async () => {
    const store = prepare();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    store.setMeetingReview({ phase: "discussion", deadline: null, confirmations: ["", "", ""] });
    await store.reviewProgress();
    store.setMeetingReview({ phase: "review", deadline: Date.now() + 120_000, confirmations: ["", "", ""] });
    await store.reviewProgress();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("invalidates final confirmation on new information and resets the phase", () => {
    const store = prepare();
    store.setMeetingReview({ phase: "complete", deadline: Date.now(), confirmations: ["合意", "ずれなし", "田中が明日確認"] });
    store.submitTranscript("期限は再検討が必要です", "manual");
    expect(store.getSnapshot().meetingReview.phase).toBe("final");
    expect(store.getSnapshot().meetingReview.confirmations).toEqual(["", "", ""]);
    store.reset();
    expect(store.getSnapshot().meetingReview.phase).toBe("discussion");
  });
  it("discards AI guidance when returning to discussion", async () => {
    const store = prepare();
    let complete!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
    const prompts = store.getSnapshot().discussionPrompts;
    const pending = store.reviewProgress();
    store.setMeetingReview({ phase: "discussion", deadline: null, confirmations: ["", "", ""] });
    complete(response(prompts)); await pending;
    expect(store.getSnapshot().progressReviewStatus).toBe("rules");
    expect(store.getSnapshot().discussionPrompts.every((p) => p.source === "rules")).toBe(true);
  });
  it("connects the next voice segment only after explicitly arming a question", () => {
    const store = createTopicEngineStore();
    store.submitTranscript("資料を作成しましょう", "manual");
    const prompt = store.getSnapshot().discussionPrompts[0];
    store.armDiscussionPrompt(prompt.id, true);
    store.addTranscriptText("確認には担当者へのヒアリングが必要です");
    store.flushBuffer();
    const state = store.getSnapshot();
    expect(state.armedDiscussionPrompt).toBeNull();
    expect(state.discussionPrompts.find((item) => item.id === prompt.id)?.answerSegmentId).toBe(state.segmentArchive[1].id);
    expect(state.discussionPrompts.find((item) => item.parentPromptId === prompt.id)?.question).toContain(prompt.branches[1].next);
    store.submitTranscript("別の資料も確認しましょう", "manual");
    expect(store.getSnapshot().discussionPrompts.find((item) => item.id === prompt.id)?.answerSegmentIds).toHaveLength(1);
  });
  it("falls back without a model and preserves live input after a failed request", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const store = createTopicEngineStore();
    store.submitTranscript("資料を作成しましょう", "manual");
    await store.reviewProgress();
    expect(fetch).not.toHaveBeenCalled();
    store.setLlmSettings({ ...DEFAULT_LLM_SETTINGS, model: "local" });
    store.setMeetingReview({ phase: "review", deadline: Date.now() + 600_000, confirmations: ["", "", ""] });
    await store.reviewProgress();
    expect(store.getSnapshot().progressReviewStatus).toBe("error");
    expect(store.getSnapshot().discussionPrompts.length).toBeGreaterThan(0);
    store.submitTranscript("追加の資料も必要です", "manual");
    expect(store.getSnapshot().segmentArchive).toHaveLength(2);
  });
  it("applies grounded AI suggestions once per revision", async () => {
    const store = prepare();
    const fetch = vi.fn().mockResolvedValue(response(store.getSnapshot().discussionPrompts.filter((prompt) => prompt.status === "open").slice(0, 3)));
    vi.stubGlobal("fetch", fetch);
    await store.reviewProgress();
    expect(store.getSnapshot().progressReviewStatus).toBe("ai");
    await store.reviewProgress();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("discards a response after new speech or reset, and never overlaps requests", async () => {
    const store = prepare();
    let complete!: (value: Response) => void;
    const prompts = store.getSnapshot().discussionPrompts;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const pending = store.reviewProgress();
    await store.reviewProgress();
    expect(fetch).toHaveBeenCalledTimes(1);
    store.submitTranscript("さらに費用も確認しましょう", "manual");
    complete(response(prompts));
    await pending;
    expect(store.getSnapshot().discussionPrompts.every((prompt) => prompt.source === "rules")).toBe(true);
    const second = store.reviewProgress();
    store.reset();
    complete(response(prompts));
    await second;
    expect(store.getSnapshot().discussionPrompts).toEqual([]);
    expect(store.getSnapshot().progressReviewStatus).toBe("rules");
  });
  it("aborts an unresponsive model after 20 seconds", async () => {
    vi.useFakeTimers();
    const store = prepare();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const pending = store.reviewProgress();
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;
    expect(store.getSnapshot().progressReviewStatus).toBe("error");
    expect(store.getSnapshot().progressReviewError).toContain("20秒");
  });
});
