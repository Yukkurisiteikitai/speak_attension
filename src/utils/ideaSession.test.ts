import { describe, expect, it } from "vitest";
import {
  addIdeaUtterance,
  applyGrouping,
  beginGrouping,
  buildIdeaSessionExport,
  createInitialIdeaSessionState,
  renderIdeaMarkdown,
  resumeCapture,
  toggleKeywordPick,
  type IdeaSessionState,
} from "./ideaSession";

function stateWithUtterances(): IdeaSessionState {
  let state = createInitialIdeaSessionState(1_000);
  state = addIdeaUtterance(state, "プッシュ通知が欲しい", "speech", 2_000);
  state = addIdeaUtterance(state, "やっぱりプッシュ通知とバッジ表示かな", "speech", 3_000);
  return state;
}

describe("addIdeaUtterance", () => {
  it("merges repeated keywords into one entry with mention count", () => {
    const state = stateWithUtterances();
    const push = state.keywords.find((keyword) => keyword.label === "プッシュ通知");

    expect(push).toBeDefined();
    expect(push?.mentionCount).toBe(2);
    expect(push?.utteranceIds).toHaveLength(2);
    expect(state.utterances).toHaveLength(2);
  });

  it("ignores input outside the capture phase", () => {
    let state = stateWithUtterances();
    state = beginGrouping(state);
    const next = addIdeaUtterance(state, "新しい話", "manual", 4_000);

    expect(next).toBe(state);
  });
});

describe("applyGrouping", () => {
  it("assigns group ids and collects leftovers into その他", () => {
    let state = stateWithUtterances();
    state = beginGrouping(state);
    const [first] = state.keywords;
    state = applyGrouping(state, [{ id: "g1", title: "通知系", keywordIds: [first.id] }], "rules");

    expect(state.phase).toBe("select");
    expect(state.keywords.find((keyword) => keyword.id === first.id)?.groupId).toBe("g1");
    const otherGroup = state.groups.find((group) => group.title === "その他");
    expect(otherGroup).toBeDefined();
    expect(state.keywords.every((keyword) => keyword.groupId !== null)).toBe(true);
  });
});

describe("resumeCapture", () => {
  it("returns to capture and clears groups but keeps keywords", () => {
    let state = stateWithUtterances();
    state = beginGrouping(state);
    state = applyGrouping(state, [], "rules");
    const keywordCount = state.keywords.length;
    state = resumeCapture(state);

    expect(state.phase).toBe("capture");
    expect(state.groups).toHaveLength(0);
    expect(state.keywords).toHaveLength(keywordCount);
    expect(state.keywords.every((keyword) => keyword.groupId === null)).toBe(true);
  });
});

describe("toggleKeywordPick / renderIdeaMarkdown", () => {
  it("renders picked keywords under their group with source utterances", () => {
    let state = stateWithUtterances();
    state = beginGrouping(state);
    state = applyGrouping(state, [], "rules");
    const push = state.keywords.find((keyword) => keyword.label === "プッシュ通知");
    if (!push) throw new Error("expected keyword missing");
    state = toggleKeywordPick(state, push.id);

    const markdown = renderIdeaMarkdown(state, 10_000);

    expect(markdown).toContain("## 採用アイデア");
    expect(markdown).toContain("プッシュ通知(言及2回)");
    expect(markdown).toContain("出典: 「プッシュ通知が欲しい」");
  });
});

describe("buildIdeaSessionExport", () => {
  it("keeps keyword-to-utterance links for RAG reuse", () => {
    const state = stateWithUtterances();
    const exported = buildIdeaSessionExport(state, 9_000);

    expect(exported.kind).toBe("idea_session");
    const push = exported.keywords.find((keyword) => keyword.label === "プッシュ通知");
    expect(push?.utteranceIds.every((id) => exported.utterances.some((utterance) => utterance.id === id))).toBe(true);
  });
});
