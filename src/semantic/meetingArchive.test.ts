import { describe, expect, it, vi } from "vitest";
import { createTopicEngineStore } from "../hooks/topicEngineStore";
import { entriesOfKind } from "./canonicalReducer";
import { projectMeetingArchive, validateMeetingArchive } from "./meetingArchive";
import { MemoryMeetingArchiveStorage } from "./meetingArchiveStorage";
import { projectMeetingMinutes } from "./meetingMinutesProjection";
import { buildTimelineProjection } from "./timelineProjection";
import { exportMinutesJson, exportMinutesMarkdown } from "./meetingMinutesExport";
import { canBulkVerify } from "./reviewEventReducer";
import { compareDecisionProjections } from "./meetingStateConsistency";

async function makeArchivedMeeting(storage: import("./meetingArchiveStorage").MeetingArchiveStorage = new MemoryMeetingArchiveStorage()) {
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  const store = createTopicEngineStore({ storage });
  store.submitTranscript("A案を採用します", "manual");
  store.submitTranscript("今の発言は撤回します", "manual");
  store.submitTranscript("B案を採用します", "manual");
  store.submitTranscript("鈴木さんが金曜日までに資料を作成します", "manual");
  store.submitTranscript("佐藤さんが月曜日までに原稿を提出します", "manual");
  store.submitTranscript("予算は100万円くらいで進められそうです", "manual");
  store.finishMeeting();
  return { store, storage };
}

describe("meeting archive integrity and projections", () => {
  it("reports decision disagreements between the legacy dashboard and canonical minutes", () => {
    expect(compareDecisionProjections(["議事録のみ", "両方"], ["ダッシュボードのみ", "両方"])).toEqual({
      canonicalOnlyDecisions: ["議事録のみ"], dashboardOnlyDecisions: ["ダッシュボードのみ"],
    });
  });

  it("restores the same pending, recorded, held and history projections from the source events", async () => {
    const { store, storage } = await makeArchivedMeeting();
    const pending = store.getArchive()!;
    await storage.save(pending);

    const items = projectMeetingMinutes(pending.id, store.getSnapshot().semantic.canonical, { events: pending.events, nextSeq: 9 });
    const eligible = items.pending.filter(canBulkVerify);
    expect(eligible).toHaveLength(2);
    expect((await store.reviewMinutes(eligible, { kind: "ItemHumanVerified" }, true)).ok).toBe(true);
    const updated = store.getArchive()!;
    await storage.save(updated);
    const currentItems = projectMeetingMinutes(updated.id, store.getSnapshot().semantic.canonical, { events: updated.events, nextSeq: 9 });

    const checked = validateMeetingArchive(await storage.load(updated.id).then((result) => result.ok ? result.value : null));
    expect(checked.valid).toBe(true);
    if (!checked.valid) return;
    const restored = projectMeetingArchive(checked.archive);
    const projected = projectMeetingMinutes(checked.archive.id, restored.canonical, { events: checked.archive.events, nextSeq: 9 });
    expect(projected.pending.map((item) => item.semanticState)).not.toContain("withdrawn");
    expect(projected.history.map((event) => event.action)).toContain("ItemWithdrawn");

    expect(restored.timelineItems.map((item) => [item.id, item.reviewState])).toEqual(projected.items.map((item) => [item.id, item.reviewState]));
    for (const item of projected.items) for (const ref of item.evidenceRefs) {
      const utterance = checked.archive.events.find((event) => event.kind === "utterance_added" && event.utterance.id === ref.utteranceId);
      expect(utterance?.kind === "utterance_added" && utterance.utterance.text.slice(ref.startOffset, ref.endOffset)).toBe(ref.text);
    }
    const metadata = checked.archive.metadata;
    expect(exportMinutesMarkdown(projected, metadata)).toBe(exportMinutesMarkdown(currentItems, metadata));
    expect(exportMinutesJson(projected, metadata)).toBe(exportMinutesJson(currentItems, metadata));

  });

  it("rejects unknown schemas, damaged spans, missing IDs and duplicate event loads", async () => {
    const { store, storage } = await makeArchivedMeeting();
    const archive = store.getArchive()!;
    expect(validateMeetingArchive({ ...archive, schemaVersion: 99 })).toMatchObject({ valid: false, reason: "unsupported_schema" });
    const damaged = structuredClone(archive);
    const utteranceEvent = damaged.events.find((event) => event.kind === "utterance_added");
    const itemEvent = damaged.events.find((event) => event.kind === "item_review");
    if (utteranceEvent?.kind === "utterance_added" && itemEvent?.kind === "item_review") {
      itemEvent.event.after.evidenceRefs[0].endOffset += 4;
      expect(validateMeetingArchive(damaged)).toMatchObject({ valid: false, reason: "corrupt_evidence" });
    }
    await storage.save(archive);
    const before = projectMeetingArchive(archive).canonical.entries.length;
    const duplicated = structuredClone(archive);
    duplicated.events = [...duplicated.events, ...archive.events.filter((event) => event.kind === "item_review")];
    expect(validateMeetingArchive(duplicated)).toMatchObject({ valid: false, reason: "invalid_data" });
    expect(projectMeetingArchive(archive).canonical.entries.length).toBe(before);
    const store2 = createTopicEngineStore({ storage });
    expect((await store2.restoreMeeting(archive.id)).ok).toBe(true);
    expect(store2.getSnapshot().semantic.canonical.entries.length).toBe(before);
  });

  it("does not lose an edited item or append duplicate events when the same archive is reopened", async () => {
    const { store, storage } = await makeArchivedMeeting();
    const archive = store.getArchive()!;
    await storage.save(archive);
    const minutes = projectMeetingMinutes(archive.id, store.getSnapshot().semantic.canonical, { events: archive.events, nextSeq: 9 });
    const task = minutes.pending.find((item) => item.kind === "action")!;
    expect((await store.reviewMinutes([task], { kind: "ItemCorrected", correction: {
      title: "資料を完成させる", kind: "action", semanticState: "agreed",
      fields: { ...task.fields, owner: "佐藤", deadline: "来週月曜", content: "配布用資料" },
    }, reason: "合意内容の訂正" })).ok).toBe(true);
    const saved = store.getArchive()!;
    await storage.save(saved);
    const reopened = createTopicEngineStore({ storage });
    expect((await reopened.restoreMeeting(saved.id)).ok).toBe(true);
    expect(projectMeetingMinutes(saved.id, reopened.getSnapshot().semantic.canonical, reopened.getArchive()! as never)
      .items.find((item) => item.id === task.id)).toMatchObject({ title: "資料を完成させる", fields: { owner: "佐藤" } });
    expect(buildTimelineProjection(reopened.getSnapshot().semantic)[3]?.units[0]?.text).toBe("資料を完成させる");
    expect(reopened.getArchive()?.events.filter((event) => event.kind === "human_correction")).toHaveLength(1);
  });

  it("keeps a corrected schedule title in Canonical and the review projection", async () => {
    const store = createTopicEngineStore({ storage: new MemoryMeetingArchiveStorage() });
    store.submitTranscript("次回レビューは木曜15時にします。", "manual");
    store.finishMeeting();
    const archive = store.getArchive()!;
    const before = projectMeetingMinutes(archive.id, store.getSnapshot().semantic.canonical, { events: archive.events, nextSeq: 2 });
    const item = before.items[0];
    const result = await store.reviewMinutes([item], { kind: "ItemCorrected", correction: {
      title: "訂正した日程", kind: item.kind, semanticState: item.semanticState,
      fields: { ...item.fields, target: "レビュー会議" },
    }, reason: "訂正テスト" });
    expect(result.ok).toBe(true);
    const corrected = store.getSnapshot().semantic.canonical.entries.find((entry) => entry.source.assertion.unit.id === item.id);
    expect(corrected?.label).toBe("訂正した日程");
    expect(store.getSnapshot().semantic.canonical.corrections.at(-1)?.item?.title).toBe("訂正した日程");
    expect(projectMeetingMinutes(archive.id, store.getSnapshot().semantic.canonical, store.getArchive()! as never).items[0].title).toBe("訂正した日程");
  });

  it("exposes storage failure and refuses to mark a meeting saved", async () => {
    const { store } = await makeArchivedMeeting({
      list: async () => ({ ok: false, error: "unavailable" }),
      load: async () => ({ ok: false, error: "unavailable" }),
      save: async () => ({ ok: false, error: "quota" }),
      remove: async () => ({ ok: false, error: "unavailable" }),
    });
    expect(await store.saveMeeting()).toEqual({ ok: false, error: "端末の保存容量が不足しています。会議データは保存されていません。" });
  });
});
