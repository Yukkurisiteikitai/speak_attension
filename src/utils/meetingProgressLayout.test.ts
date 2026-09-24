import { describe, expect, it } from "vitest";
import { projectMeetingProgress } from "./meetingProgressLayout";
import type { MeetingProgress } from "./meetingProgress";

describe("meeting progress layout", () => {
  it.each(["短い案", "長い日本語の判断理由と追加確認の予定です".repeat(50), "unbrokenlabel".repeat(100)])("bounds previews and separates branches for %s", (label) => {
    const progress: MeetingProgress = { nodes: [{ id: "progress-root", parentId: null, kind: "会議", label, planned: false }], links: [], prompts: [] };
    for (let i = 0; i < 32; i++) progress.nodes.push({ id: `n-${i}`, parentId: i < 4 ? "progress-root" : `n-${Math.floor((i - 4) / 3)}`, label, kind: "予定・条件付き", planned: i > 15 });
    const { nodes, edges } = projectMeetingProgress(progress, true);
    expect(nodes).toHaveLength(33);
    expect(edges).toHaveLength(32);
    for (const a of nodes) {
      expect(String(a.data.label).length).toBeLessThan(90);
      for (const b of nodes.filter((node) => node.id !== a.id)) expect(Math.abs(a.position.x - b.position.x) >= 290 || Math.abs(a.position.y - b.position.y) >= 150).toBe(true);
    }
    expect(progress.nodes[0].label).toBe(label);
  });
});
