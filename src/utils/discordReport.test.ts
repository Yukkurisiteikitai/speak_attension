import { describe, expect, it } from "vitest";
import { splitDiscordReport } from "./discordReport";

describe("splitDiscordReport", () => {
  it("keeps a long report complete and numbers bounded Discord posts", () => {
    const report = `# 会議\n${"議題😀".repeat(1300)}`;
    const parts = splitDiscordReport(report);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 2000)).toBe(true);
    expect(parts.map((part) => part.replace(/^\[会議レポート \d+\/\d+\]\n/, "")).join("")).toBe(report);
  });

  it("fails before posting an exceptionally large report", () => {
    expect(() => splitDiscordReport("あ".repeat(1800 * 41))).toThrow("Markdownとして保存");
  });
});
