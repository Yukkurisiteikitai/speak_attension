import { describe, expect, it } from "vitest";
import { importTimedTranscriptJson } from "./transcriptImporter";
import { collectReplaySegments } from "./transcriptReplay";

describe("transcript importer", () => {
  it("loads valid transcript json", () => {
    const segments = importTimedTranscriptJson(
      JSON.stringify([
        {
          id: "seg-1",
          startMs: 0,
          endMs: 1200,
          speaker: "A",
          text: "開始します",
          source: "official_transcript",
        },
      ]),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      id: "seg-1",
      startMs: 0,
      endMs: 1200,
      speaker: "A",
      text: "開始します",
      source: "official_transcript",
    });
  });

  it("sorts segments by startMs", () => {
    const segments = importTimedTranscriptJson(
      JSON.stringify([
        { id: "seg-2", startMs: 3000, text: "後", source: "offline_stt" },
        { id: "seg-1", startMs: 1000, text: "先", source: "offline_stt" },
      ]),
    );

    expect(segments.map((segment) => segment.id)).toEqual(["seg-1", "seg-2"]);
  });

  it("rejects segment without text", () => {
    expect(() =>
      importTimedTranscriptJson(JSON.stringify([{ id: "seg-1", startMs: 1000, source: "manual_replay" }])),
    ).toThrow("1件目の text がありません。");
  });

  it("rejects segment with non numeric startMs", () => {
    expect(() =>
      importTimedTranscriptJson(
        JSON.stringify([{ id: "seg-1", startMs: "1000", text: "invalid", source: "audio_replay" }]),
      ),
    ).toThrow("1件目の startMs は数値にしてください。");
  });
});

describe("transcript replay", () => {
  it("does not emit the same segment twice", () => {
    const segments = importTimedTranscriptJson(
      JSON.stringify([
        { id: "seg-1", startMs: 1000, text: "one", source: "manual_replay" },
        { id: "seg-2", startMs: 2000, text: "two", source: "manual_replay" },
      ]),
    );

    const firstAdvance = collectReplaySegments(segments, 1500, 0);
    expect(firstAdvance.emittedSegments.map((segment) => segment.id)).toEqual(["seg-1"]);

    const secondAdvance = collectReplaySegments(segments, 1500, firstAdvance.nextIndex);
    expect(secondAdvance.emittedSegments).toEqual([]);
    expect(secondAdvance.nextIndex).toBe(1);
  });
});
