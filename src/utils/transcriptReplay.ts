import type { TimedTranscriptSegment } from "../types/topic";

export type ReplaySpeed = 1 | 2 | 5 | "instant";

export type ReplayAdvanceResult = {
  emittedSegments: TimedTranscriptSegment[];
  nextIndex: number;
};

export function collectReplaySegments(
  segments: TimedTranscriptSegment[],
  playbackTimeMs: number,
  nextIndex: number,
): ReplayAdvanceResult {
  let cursor = nextIndex;

  while (cursor < segments.length && segments[cursor].startMs <= playbackTimeMs) {
    cursor += 1;
  }

  return {
    emittedSegments: segments.slice(nextIndex, cursor),
    nextIndex: cursor,
  };
}

export function formatReplayTime(playbackTimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(playbackTimeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
