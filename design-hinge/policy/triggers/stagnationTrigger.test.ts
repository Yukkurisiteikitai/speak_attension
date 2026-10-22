import { describe, expect, it } from "vitest";
import { detectStagnationTrigger } from "./stagnationTrigger";

describe("detectStagnationTrigger", () => {
  it("returns null when there aren't enough utterances yet to fill the window", () => {
    expect(detectStagnationTrigger(["同じ話です", "同じ話です"], 3, 0.85, 1000)).toBeNull();
  });

  it("fires when the window is filled with near-identical utterances", () => {
    const utterances = ["同じ話です", "同じ話です", "同じ話です", "同じ話です"];
    const candidate = detectStagnationTrigger(utterances, 3, 0.85, 1000);
    expect(candidate).not.toBeNull();
    expect(candidate?.triggerType).toBe("stagnation");
  });

  it("does not fire when recent utterances are varied", () => {
    const utterances = ["容疑者は調査できない", "情報が不足する", "信用管理が必要になる", "感情的報酬が変化する"];
    expect(detectStagnationTrigger(utterances, 3, 0.85, 1000)).toBeNull();
  });

  it("does not fire when only some of the window is similar to the latest", () => {
    const utterances = ["容疑者は調査できない", "同じ話です", "同じ話です", "同じ話です"];
    expect(detectStagnationTrigger(utterances, 3, 0.85, 1000)).toBeNull();
  });
});
