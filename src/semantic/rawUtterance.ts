// Layer 1: the append-only raw utterance event log (ADR 0022 §2).
//
// Every input provider -- manual, replay, Web Speech, a future STT -- lands
// here as the same RawUtterance. Re-analysis consumes this log and never writes
// back to it, which is what makes a human correction survive re-parsing.

import type { InputProviderKind, MeetingEvent, RawUtterance, UtteranceId } from "./types";

export type MeetingEventLog = {
  events: MeetingEvent[];
  // Next seq to hand out. Kept here so ordering never depends on createdAt,
  // which repeats when two utterances land in the same millisecond.
  nextSeq: number;
};

export function createEventLog(): MeetingEventLog {
  return { events: [], nextSeq: 1 };
}

export type RawUtteranceInput = {
  id: UtteranceId;
  text: string;
  createdAt: number;
  provider: InputProviderKind;
  // Absent or blank means unknown. Never guessed from the text.
  speaker?: string | null;
  audio?: RawUtterance["audio"];
};

export function createRawUtterance(input: RawUtteranceInput, seq: number): RawUtterance {
  const speaker = input.speaker?.trim();
  return {
    id: input.id,
    seq,
    // Verbatim on purpose: normalization is a derived concern, and the log is
    // the primary source.
    text: input.text,
    createdAt: input.createdAt,
    speaker: speaker ? speaker : null,
    provider: input.provider,
    ...(input.audio ? { audio: input.audio } : {}),
  };
}

// Append-only: returns a new log and never mutates the one passed in.
export function appendEvent(log: MeetingEventLog, event: MeetingEvent): MeetingEventLog {
  return { events: [...log.events, event], nextSeq: log.nextSeq };
}

export function appendUtterance(log: MeetingEventLog, input: RawUtteranceInput): { log: MeetingEventLog; utterance: RawUtterance } {
  const utterance = createRawUtterance(input, log.nextSeq);
  return {
    log: {
      events: [...log.events, { kind: "utterance_added", at: input.createdAt, utterance }],
      nextSeq: log.nextSeq + 1,
    },
    utterance,
  };
}

export function utterancesOf(log: MeetingEventLog): RawUtterance[] {
  return log.events.flatMap((event) => (event.kind === "utterance_added" ? [event.utterance] : []));
}

// The rolling context the fast path is allowed to look at (ADR 0023 §4). Never
// the whole meeting: a caller that needs history belongs on the refinement path.
export function recentUtterances(log: MeetingEventLog, windowSize: number): RawUtterance[] {
  if (windowSize <= 0) return [];
  const all = utterancesOf(log);
  return all.slice(Math.max(0, all.length - windowSize));
}
