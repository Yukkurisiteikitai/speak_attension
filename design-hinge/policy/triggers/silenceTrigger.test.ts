import { describe, expect, it } from "vitest";
import { detectSilenceTrigger } from "./silenceTrigger";

describe("detectSilenceTrigger", () => {
  it("returns null when there has been no utterance yet", () => {
    expect(detectSilenceTrigger(null, 10000, 6000)).toBeNull();
  });

  it("returns null when the silence duration is below the threshold", () => {
    expect(detectSilenceTrigger(5000, 8000, 6000)).toBeNull(); // 3000ms < 6000ms
  });

  it("fires once the silence duration reaches the threshold", () => {
    const candidate = detectSilenceTrigger(5000, 11000, 6000); // 6000ms >= 6000ms
    expect(candidate).not.toBeNull();
    expect(candidate?.triggerType).toBe("silence");
    expect(candidate?.reasonSummary).toContain("6秒");
  });

  it("fires when the silence duration exceeds the threshold", () => {
    const candidate = detectSilenceTrigger(0, 20000, 6000);
    expect(candidate).not.toBeNull();
    expect(candidate?.reasonSummary).toContain("20秒");
  });
});
