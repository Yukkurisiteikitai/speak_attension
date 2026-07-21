import { describe, expect, it } from "vitest";
import {
  addIdeaUtterance,
  applyGrouping,
  beginGrouping,
  buildIdeaSessionExport,
  createIdeaSessionFromMeetingSelection,
  createInitialIdeaSessionState,
  renameIdeaGroup,
  renderIdeaMarkdown,
  resumeCapture,
  setKeywordDecision,
  type IdeaSessionState,
} from "./ideaSession";
import type { AnalyzedSegment, MeetingSummary } from "../types/topic";

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

describe("setKeywordDecision / renderIdeaMarkdown", () => {
  it("renders all three decisions under their group with source utterances", () => {
    let state = stateWithUtterances();
    state = beginGrouping(state);
    state = applyGrouping(state, [], "rules");
    const push = state.keywords.find((keyword) => keyword.label === "プッシュ通知");
    if (!push) throw new Error("expected keyword missing");
    state = setKeywordDecision(state, push.id, "adopted");

    const markdown = renderIdeaMarkdown(state, 10_000);

    expect(markdown).toContain("## 採用アイデア");
    expect(markdown).toContain("## 保留アイデア");
    expect(markdown).toContain("## 却下アイデア");
    expect(markdown).toContain("プッシュ通知(言及2回)");
    expect(markdown).toContain("出典: 「プッシュ通知が欲しい」");
  });

  it("renames a group without changing its keyword membership", () => {
    let state = stateWithUtterances();
    state = applyGrouping(beginGrouping(state), [], "rules");
    const group = state.groups[0];
    state = renameIdeaGroup(state, group.id, " 通知体験 ");

    expect(state.groups[0]).toEqual({ ...group, title: "通知体験" });
  });
});

describe("buildIdeaSessionExport", () => {
  it("keeps keyword-to-utterance links for RAG reuse", () => {
    const state = stateWithUtterances();
    const exported = buildIdeaSessionExport(state, 9_000);

    expect(exported.kind).toBe("idea_session");
    expect(exported.version).toBe(2);
    const push = exported.keywords.find((keyword) => keyword.label === "プッシュ通知");
    expect(push?.utteranceIds.every((id) => exported.utterances.some((utterance) => utterance.id === id))).toBe(true);
  });
});

describe("createIdeaSessionFromMeetingSelection", () => {
  it("starts a capture session from unique evidence and keeps meeting references", () => {
    const summary: MeetingSummary = {
      meetingId: "meeting-1",
      title: "新機能会議",
      generatedAt: 5_000,
      source: "rules",
      ignoredSegmentIds: [],
      topics: [
        {
          id: "topic-1",
          title: "通知機能",
          items: [
            { id: "item-1", category: "issue", title: "通知に気づけない", evidenceSegmentIds: ["seg-1"] },
            { id: "item-2", category: "unresolved", title: "通知方法が未決定", evidenceSegmentIds: ["seg-1", "seg-2"] },
          ],
        },
      ],
    };
    const segments = [
      { id: "seg-1", text: "プッシュ通知に気づけないのが課題です", createdAt: 2_000 },
      { id: "seg-2", text: "メール通知も必要でしょうか", createdAt: 3_000 },
    ] as AnalyzedSegment[];

    const state = createIdeaSessionFromMeetingSelection(summary, segments, ["item-1", "item-2"], 10_000);

    expect(state.phase).toBe("capture");
    expect(state.title).toBe("新機能会議からのアイデア出し");
    expect(state.utterances).toHaveLength(2);
    expect(state.utterances[0]?.source).toBe("meeting");
    expect(state.utterances[0]?.sourceReferences).toHaveLength(2);
    expect(state.utterances[0]?.sourceReferences?.[0]).toMatchObject({
      meetingId: "meeting-1",
      topicId: "topic-1",
      segmentId: "seg-1",
    });

    const exported = buildIdeaSessionExport(state, 11_000);
    expect(exported.utterances[0]?.sourceReferences?.[0]?.itemTitle).toBe("通知に気づけない");

    let grouped = applyGrouping(beginGrouping(state), [], "rules");
    grouped = setKeywordDecision(grouped, grouped.keywords[0].id, "adopted");
    expect(renderIdeaMarkdown(grouped, 12_000)).toContain("会議: 通知機能 / 通知に気づけない");
  });
});
