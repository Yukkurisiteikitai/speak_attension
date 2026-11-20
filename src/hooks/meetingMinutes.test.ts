import { describe, expect, it } from "vitest";
import { createTopicEngineStore } from "./topicEngineStore";
import { entriesOfKind, reduceCanonical } from "../semantic/canonicalReducer";
import { projectMeetingMinutes } from "../semantic/meetingMinutesProjection";
import { buildTimelineProjection } from "../semantic/timelineProjection";
import { projectMeetingState } from "../semantic/meetingStateProjection";
import { canBulkVerify } from "../semantic/reviewEventReducer";
import { runFastPath, emptyFastPathContext } from "../semantic/fastPath";
import { utterancesOf } from "../semantic/rawUtterance";
import { exportMinutesJson, exportMinutesMarkdown } from "../semantic/meetingMinutesExport";

function session(...phrases: Array<string | [string, string]>) {
  const store = createTopicEngineStore();
  for (const [index, phrase] of phrases.entries()) {
    if (typeof phrase === "string") store.submitTranscript(phrase, "manual");
    else store.submitTimedTranscript({ id: "fixture-" + index, speaker: phrase[0], text: phrase[1], startMs: index * 1_000,
      endMs: index * 1_000 + 900, source: "manual_replay" });
  }
  store.finishMeeting();
  const semantic = () => store.getSnapshot().semantic;
  const minutes = () => projectMeetingMinutes(store.getSnapshot().engineState.meetingGraph.meetingId, semantic().canonical, semantic().log);
  return { store, semantic, minutes };
}

describe("meeting minutes from the live store", () => {
  it("records an explicit schedule agreement with two traceable spans", () => {
    const { minutes } = session(["田中", "次回レビューは木曜15時にします"], ["佐藤", "はい、その時間で確定です"]);
    expect(minutes().recorded).toMatchObject([{ kind: "schedule", fields: { deadline: "木曜15時" }, reviewState: "auto_recorded" }]);
    expect(minutes().recorded[0].evidenceRefs.map((ref) => ref.speakerId)).toEqual(["田中", "佐藤"]);
    expect(minutes().history.map((event) => event.action)).toEqual(["ItemAutoRecorded"]);
  });

  it("keeps tentative releases and unresolved QA conditions out of confirmed minutes", () => {
    const { minutes } = session("たぶん金曜に本番公開できると思います", "QAの結果を見てからですね");
    expect(minutes().recorded).toEqual([]);
    expect(minutes().pending).toMatchObject([{ semanticState: "candidate", fields: { condition: "QAの結果を見てからですね" } }]);
  });

  it("splits independent tasks within one utterance into two grounded items", () => {
    const { minutes } = session("鈴木さんが金曜日までに資料を作成します。佐藤さんが月曜日までに原稿を提出します");
    const tasks = minutes().items.filter((item) => item.kind === "action");
    expect(tasks.map((item) => item.fields.owner)).toEqual(["鈴木", "佐藤"]);
    expect(tasks[0].evidenceRefs[0].endOffset).toBe(tasks[1].evidenceRefs[0].startOffset);
    expect(tasks[0].evidenceRefs[0].utteranceId).toBe(tasks[1].evidenceRefs[0].utteranceId);
  });

  it("keeps exact offsets into the supplied transcript when whitespace differs from legacy analysis", () => {
    const raw = "  鈴木さんが金曜日までに資料を作成します。\n  佐藤さんが月曜日までに原稿を提出します  ";
    const { minutes, semantic } = session(raw);
    expect(utterancesOf(semantic().log)[0].text).toBe(raw);
    expect(minutes().items).toHaveLength(2);
    expect(minutes().items.every(({ evidenceRefs: [ref] }) => raw.slice(ref.startOffset, ref.endOffset) === ref.text)).toBe(true);
  });

  it("propagates a spoken withdrawal to Canonical, minutes and the history", () => {
    const { minutes, semantic } = session("A案を採用します", "すみません、今の発言は撤回します");
    expect(entriesOfKind(semantic().canonical, "decision")).toEqual([]);
    expect(projectMeetingState(semantic().canonical).confirmedDecisions).toEqual([]);
    expect(minutes().recorded).toEqual([]);
    expect(minutes().history).toMatchObject([{ action: "ItemWithdrawn", after: { semanticState: "withdrawn" } }]);
    expect(minutes().items[0].evidenceRefs).toHaveLength(2);
  });

  it("blocks a linked task after withdrawal and processes named supersession", () => {
    const first = session("A案を採用します", "鈴木さんがA案の資料を金曜日までに作成します", "A案の決定を撤回します");
    expect(first.minutes().pending).toMatchObject([{ kind: "action", canVerify: false }]);
    const second = session("A案を採用します", "A案からB案に変更します");
    expect(second.minutes().history).toMatchObject([{ action: "ItemSuperseded" }]);
    expect(entriesOfKind(second.semantic().canonical, "decision")).toHaveLength(1);
  });

  it("reclassifies a recorded decision, preserves the original, and survives re-assertion", async () => {
    const { store, semantic, minutes } = session("A案を採用します");
    const original = minutes().recorded[0];
    const correction = { ...original, title: "A案は候補", kind: "proposal" as const,
      semanticState: "candidate" as const, fields: { ...original.fields, content: "候補として列挙" } };
    expect((await store.reviewMinutes([original], { kind: "ItemCorrected", correction, reason: "候補として列挙しただけ" })).ok).toBe(true);
    expect(entriesOfKind(semantic().canonical, "decision")).toEqual([]);
    expect(minutes().recorded).toEqual([]);
    expect(minutes().pending[0]).toMatchObject({ id: original.id, title: "A案は候補" });
    expect(utterancesOf(semantic().log)[0].text).toBe("A案を採用します");
    expect(buildTimelineProjection(semantic())[0].units[0].promotion?.kind).toBe("proposal");
    const raw = utterancesOf(semantic().log)[0];
    const { assertions } = runFastPath({ utterance: raw, context: emptyFastPathContext() });
    const event = { kind: "units_asserted" as const, at: raw.createdAt, utterance: raw, assertions };
    const twice = reduceCanonical(reduceCanonical(semantic().canonical, event).state, event).state;
    expect(entriesOfKind(twice, "decision")).toEqual([]);
    expect(projectMeetingMinutes(original.meetingId, twice, semantic().log).pending).toHaveLength(1);
  });

  it("applies a classification correction directly from the timeline", async () => {
    const { store, semantic, minutes } = session("A案を採用します");
    const item = minutes().recorded[0];
    store.recordSemanticCorrection({ unitId: item.id, utteranceId: item.evidenceRefs[0].utteranceId }, { role: "proposal" });
    expect(entriesOfKind(semantic().canonical, "decision")).toEqual([]);
    expect(minutes().pending[0].kind).toBe("proposal");
    expect(minutes().history.at(-1)?.action).toBe("ItemCorrected");
  });

  it("blocks informal and explicit budget mentions from verification and bulk selection", async () => {
    const { store, minutes } = session("予算は100万円くらいで進められそうです", "責任者に確認しましょう", "予算100万円に決定します");
    const high = minutes().pending.filter((item) => item.riskLevel === "high");
    expect(high).toHaveLength(3);
    expect(high.every((item) => !canBulkVerify(item))).toBe(true);
    expect((await store.reviewMinutes([high[2]], { kind: "ItemHumanVerified" })).ok).toBe(false);
    expect((await store.reviewMinutes(high, { kind: "ItemHumanVerified" }, true)).ok).toBe(false);
  });

  it("holds, verifies, reopens, and reverses actions with a history", async () => {
    const { store, minutes } = session("鈴木さんが金曜日までに資料を作成します");
    expect((await store.reviewMinutes(minutes().pending, { kind: "ItemHeld" })).ok).toBe(true);
    expect((await store.reviewMinutes(minutes().held, { kind: "ItemHumanVerified" })).ok).toBe(true);
    expect((await store.reviewMinutes(minutes().recorded, { kind: "ItemReviewReopened" })).ok).toBe(true);
    expect((await store.reviewMinutes(minutes().pending, { kind: "ReviewActionReverted" })).ok).toBe(true);
    expect(minutes().recorded[0].reviewState).toBe("human_verified");
    expect(minutes().history.at(-1)?.reverts).toBe(minutes().history[2].id);
  });

  it("validates the entire bulk preview before writing and deduplicates requests", async () => {
    const { store, minutes } = session("鈴木さんが金曜日までに資料を作成します", "佐藤さんが月曜日までに原稿を提出します");
    const preview = minutes().pending;
    expect(preview.every(canBulkVerify)).toBe(true);
    await store.reviewMinutes([preview[0]], { kind: "ItemHeld" });
    expect((await store.reviewMinutes(preview, { kind: "ItemHumanVerified" }, true)).ok).toBe(false);
    expect(minutes().recorded).toEqual([]);
    const targets = minutes().pending;
    expect((await store.reviewMinutes(targets, { kind: "ItemHumanVerified" }, true)).ok).toBe(true);
    expect((await store.reviewMinutes(targets, { kind: "ItemHumanVerified" }, true)).ok).toBe(false);
    expect(minutes().recorded).toHaveLength(1);
  });

  it("drops the previously recorded schedule after a conflicting date and keeps its evidence", async () => {
    const { store, minutes } = session(["田中", "次回レビューは木曜15時にします"], ["佐藤", "はい、その時間で確定です"]);
    expect(minutes().recorded).toHaveLength(1);
    store.resumeMeeting();
    store.submitTranscript("次回レビューは金曜16時にします", "manual");
    store.finishMeeting();
    expect(minutes().recorded).toEqual([]);
    expect(minutes().pending.map((item) => item.fields.deadline)).toEqual(["木曜15時", "金曜16時"]);
    expect(minutes().pending[0].evidenceRefs).toHaveLength(3);
  });

  it("projects edited action fields into Canonical and the timeline, with an exportable audit trail", async () => {
    const { store, semantic, minutes } = session("鈴木さんが金曜日までに資料を作成します");
    const item = minutes().pending[0];
    expect((await store.reviewMinutes([item], { kind: "ItemCorrected", correction: {
      title: "資料を作成", kind: "action", semanticState: "agreed",
      fields: { ...item.fields, owner: "佐藤", deadline: "来週月曜", content: "配布用の資料を作成" },
    }, reason: "担当と期限を会議で訂正" })).ok).toBe(true);
    expect(entriesOfKind(semantic().canonical, "action")[0]).toMatchObject({ owner: "佐藤", deadline: "来週月曜" });
    expect(buildTimelineProjection(semantic())[0].units[0].item?.fields.owner).toBe("佐藤");
    const metadata = { title: "資料会議", startedAt: 1, endedAt: 2 };
    const markdown = exportMinutesMarkdown(minutes(), metadata);
    expect(markdown.split("## 確認待ち")[0]).not.toContain("配布用");
    expect(markdown).toContain("暫定版");
    expect(markdown).toContain("変更前");
    expect(JSON.parse(exportMinutesJson(minutes(), metadata))).toMatchObject({
      provisional: true, recorded: [], pending: [{ fields: { owner: "佐藤" } }],
    });
  });

  it("does not duplicate a correction, keep stale approval, or mutate transcript text", async () => {
    const { store, semantic, minutes } = session(["鈴木", "私が金曜日までに資料を作成します"]);
    const item = minutes().recorded[0];
    const request = { kind: "ItemCorrected" as const, correction: { ...item, title: "新しい資料" }, reason: "対象の訂正" };
    expect((await store.reviewMinutes([item], request)).ok).toBe(true);
    expect((await store.reviewMinutes([item], request)).ok).toBe(false);
    expect(minutes().history.filter((entry) => entry.action === "ItemCorrected")).toHaveLength(1);
    expect(minutes().recorded).toHaveLength(0);
    expect(utterancesOf(semantic().log)[0].text).toBe("私が金曜日までに資料を作成します");
  });
});
