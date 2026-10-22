import { describe, expect, it } from "vitest";
import type { MeetingDecisionGraph, MeetingDecisionNode } from "../types/topic";
import { buildMeetingStateSnapshot, renderMeetingStateMarkdown, selectPendingMeetingNodes } from "./meetingState";
import { selectCurrentActions, updateMeetingAction } from "./meetingDecisionGraph";

const node = (id: string, type: MeetingDecisionNode["type"]): MeetingDecisionNode => ({ id, type, label: `発言 ${id}`, state: "human_stated", createdAt: 1000, provenance: { utteranceIds: ["source"], createdBy: "human" } });
const graph: MeetingDecisionGraph = {
  nodes: [node("source", "utterance"), node("proposal", "proposal"), node("question", "question"),
    { ...node("action", "action"), state: "decided", action: { what: "確認します", owner: "田中", deadline: "明日", urgency: "high", status: "decided" } }],
  edges: [{ id: "source-edge", source: "action", target: "source", relation: "derived_from" }],
};

describe("meeting state", () => {
  it("exports a detached snapshot with current work and complete provenance, including outcomes", () => {
    const updated = updateMeetingAction(graph, "action", { note: "確認しました", status: "done" }, { id: "record", createdAt: 2000 });
    const snapshot = buildMeetingStateSnapshot(updated, { meetingId: "meeting", title: "テスト会議" }, 3000);
    expect(snapshot.currentActionIds).toEqual([]);
    expect(snapshot.graph).toEqual(updated);
    expect(snapshot.graph).not.toBe(updated);
    const record = snapshot.graph.nodes.find((n) => n.id === "record")!;
    expect(record.actionChange).toMatchObject({ before: { status: "decided" }, after: { status: "done" } });
    expect(record.provenance.utteranceIds).toEqual([]);
    const markdown = renderMeetingStateMarkdown(snapshot);
    expect(markdown).toContain("状態: 完了");
    expect(markdown).toContain("(#action)");
    expect(markdown).toContain("(#source)");
    expect(markdown).toContain("操作担当者");
    expect(markdown).toContain("担当: 田中 / 期限: 明日");
    snapshot.graph.nodes[0].label = "変更";
    expect(updated.nodes[0].label).toBe("発言 source");
  });
  it("separates pending proposals and questions from adopted and answered items", () => {
    expect(selectPendingMeetingNodes(graph).map((n) => n.id)).toEqual(["proposal", "question"]);
    const resolved = { ...graph, edges: [...graph.edges,
      { id: "adopt", source: "action", target: "proposal", relation: "decided_from" as const },
      { id: "answer", source: "source", target: "question", relation: "answers" as const }] };
    expect(selectPendingMeetingNodes(resolved)).toEqual([]);
  });
  it("does not put proposed work in NOW and retains it in pending items", () => {
    const updated = updateMeetingAction(graph, "action", { note: "再検討", status: "proposed" }, { id: "record", createdAt: 2000 });
    expect(selectCurrentActions(updated)).toEqual([]);
    expect(selectPendingMeetingNodes(updated).map((n) => n.id)).toContain("action");
  });
});
