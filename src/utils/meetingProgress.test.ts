import { describe, expect, it } from "vitest";
import { createTopicEngineStore } from "../hooks/topicEngineStore";
import { buildMeetingProgress, buildDiscussionPrompts, renderMeetingProgressMarkdown } from "./meetingProgress";

function meeting(texts: string[]) {
  const store = createTopicEngineStore();
  texts.forEach((text) => store.submitTranscript(text, "manual"));
  return store;
}

describe("meeting progress", () => {
  it("retains the order, reasons, alternatives and the proposal actually adopted", () => {
    const store = meeting(["今日は連絡方法について決めます", "候補者への連絡が遅い問題があります", "理由は担当が不足しているからです", "A案でメールを自動化しましょう", "別案としてB案で電話を増やしましょう", "A案を採用します"]);
    const state = store.getSnapshot();
    const graph = state.engineState.decisionGraph;
    const progress = buildMeetingProgress(state.conversationTree, graph, state.segmentArchive, state.discussionPrompts);
    const proposal = progress.nodes.find((node) => node.segmentId === state.segmentArchive[3].id)!;
    const decision = progress.nodes.find((node) => node.segmentId === state.segmentArchive[5].id)!;
    expect(decision.parentId).toBe(proposal.id);
    expect(decision.kind).toBe("決定");
    expect(progress.nodes.find((node) => node.segmentId === state.segmentArchive[4].id)).toBeDefined();
    expect(progress.links.filter((link) => link.kind === "sequence")).toHaveLength(5);
    expect(progress.nodes.filter((node) => node.sequence).map((node) => node.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.discussionPrompts.some((prompt) => prompt.status === "open" && prompt.question.includes("B案"))).toBe(true);
    expect(graph.nodes.filter((node) => node.type === "decision" && node.provenance.utteranceIds.includes(state.segmentArchive[0].id))).toHaveLength(0);
  });

  it("connects an explicit answer to a question and activates the selected future branch", () => {
    const store = meeting(["データが不足している問題があります", "資料を確認しましょう"]);
    const question = store.getSnapshot().discussionPrompts.find((prompt) => prompt.status === "open")!;
    store.answerDiscussionPrompt(question.id, "まだ結果を確認できていません", true);
    const state = store.getSnapshot();
    const answered = state.discussionPrompts.find((prompt) => prompt.id === question.id)!;
    const next = state.discussionPrompts.find((prompt) => prompt.parentPromptId === question.id)!;
    expect(answered.status).toBe("answered");
    expect(next.question).toContain(question.branches[1].next);
    expect(next.anchorSegmentId).toBe(answered.answerSegmentId);
    const progress = buildMeetingProgress(state.conversationTree, state.engineState.decisionGraph, state.segmentArchive, state.discussionPrompts);
    expect(progress.links.some((link) => link.source === question.id && link.kind === "answer")).toBe(true);
    expect(renderMeetingProgressMarkdown(progress, state.segmentArchive)).toContain("まだ結果を確認できていません");
    store.submitTranscript("確認には一日かかりそうです", "manual");
    expect(store.getSnapshot().discussionPrompts.find((prompt) => prompt.id === next.id)?.status).toBe("open");
  });

  it("keeps deferred prompts and multiple explicit answers without duplicate IDs", () => {
    const store = meeting(["資料が不足しています"]);
    const prompt = store.getSnapshot().discussionPrompts[0];
    store.setDiscussionPromptDeferred(prompt.id, true);
    store.submitTranscript("別のデータも不足しています", "manual");
    expect(store.getSnapshot().discussionPrompts.find((item) => item.id === prompt.id)?.status).toBe("deferred");
    store.answerDiscussionPrompt(prompt.id, "一部は確認できました");
    store.setDiscussionPromptDeferred(prompt.id, false);
    store.answerDiscussionPrompt(prompt.id, "残りも確認できました");
    const prompts = store.getSnapshot().discussionPrompts;
    expect(new Set(prompts.map((item) => item.id)).size).toBe(prompts.length);
    expect(prompts.find((item) => item.id === prompt.id)?.answerSegmentIds).toHaveLength(2);
  });

  it("refreshes action gaps immediately after a targeted owner update", () => {
    const store = meeting(["資料を作成します"]);
    const state = store.getSnapshot();
    const prompt = state.discussionPrompts.find((item) => item.kind === "missing_owner")!;
    store.updateAction(prompt.actionId!, { owner: "田中", note: "担当を田中に確定" });
    expect(store.getSnapshot().discussionPrompts.find((item) => item.id === prompt.id)?.status).toBe("satisfied");
    expect(store.getSnapshot().discussionPrompts.some((item) => item.kind === "missing_due_date" && item.status === "open")).toBe(true);
    const updated = store.getSnapshot();
    const progress = buildMeetingProgress(updated.conversationTree, updated.engineState.decisionGraph, updated.segmentArchive, updated.discussionPrompts);
    expect(progress.nodes.find((node) => node.kind === "実行結果・更新")?.label).toContain("担当を田中に確定");
  });

  it("does not mutate prior prompts and retains a complete source archive including closure", () => {
    const store = meeting(["確認しましょう", "それでいこう", "以上です", "はい"]);
    const state = store.getSnapshot();
    const prior = structuredClone(state.discussionPrompts);
    buildDiscussionPrompts(state.engineState.decisionGraph, state.segmentArchive, [], state.discussionPrompts);
    expect(state.discussionPrompts).toEqual(prior);
    const progress = buildMeetingProgress(state.conversationTree, state.engineState.decisionGraph, state.segmentArchive, []);
    expect(progress.nodes.filter((node) => node.segmentId)).toHaveLength(4);
    expect(progress.links.filter((link) => link.kind === "sequence")).toHaveLength(3);
  });

  it("keeps the actual AI question that was answered when rules are recomputed", () => {
    const store = meeting(["資料を作成しましょう"]);
    const state = store.getSnapshot();
    const prompt = state.discussionPrompts.find((item) => item.kind === "compare")!;
    const answered = { ...prompt, status: "answered" as const, source: "ai" as const, question: "資料の正確性と作成時間、どちらを優先しますか？" };
    const result = buildDiscussionPrompts(state.engineState.decisionGraph, state.segmentArchive, [], [answered]);
    expect(result.find((item) => item.id === prompt.id)).toEqual(answered);
  });
});
