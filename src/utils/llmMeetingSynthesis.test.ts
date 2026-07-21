import { describe, expect, it } from "vitest";
import { parseMeetingSynthesisResponse } from "./llmMeetingSynthesis";
import type { MeetingSummary } from "../types/topic";

const fallback: MeetingSummary = {
  meetingId: "meeting-1",
  title: "採用会議",
  generatedAt: 0,
  source: "rules",
  topics: [],
  ignoredSegmentIds: ["seg-2"],
};

describe("parseMeetingSynthesisResponse", () => {
  it("keeps only evidence IDs that exist in the meeting", () => {
    const result = parseMeetingSynthesisResponse(
      '{"topics":[{"title":"AI試行","items":[{"category":"decision","title":"1週間試す","sourceSegmentIds":["seg-1","unknown"]}]}]}',
      fallback,
      new Set(["seg-1", "seg-2"]),
    );

    expect(result.source).toBe("llm");
    expect(result.topics[0].items[0].evidenceSegmentIds).toEqual(["seg-1"]);
  });

  it("rejects a response with no valid, evidenced items", () => {
    expect(() => parseMeetingSynthesisResponse('{"topics":[{"title":"AI","items":[{"category":"bad","title":"x","sourceSegmentIds":["seg-1"]}]}]}', fallback, new Set(["seg-1"]))).toThrow();
  });
});
