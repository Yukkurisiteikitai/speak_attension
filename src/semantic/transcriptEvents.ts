// The STT boundary (ADR 0023 §7).
//
// interim -> transcript preview only; it never becomes a RawUtterance and never
// reaches the event log, so a half-recognized phrase cannot end up in canonical
// state. final -> exactly one RawUtterance, which starts the fast path.
//
// Pure: the caller supplies the id/seq to use if an utterance is created, so
// the same events always produce the same result.

import type { InputProviderKind, RawUtterance, UtteranceId } from "./types";
import { createRawUtterance } from "./rawUtterance";

export type TranscriptEvent =
  | { kind: "interim"; provider: InputProviderKind; providerSeq: number; text: string; at: number }
  | { kind: "final"; provider: InputProviderKind; providerSeq: number; text: string; at: number; confidence?: number };

export type TranscriptIntakeState = {
  // What to show as "認識中". Display only.
  preview: { providerSeq: number; text: string } | null;
  // Provider sequences already finalized, so a late interim or a duplicated
  // final can be recognized and ignored.
  finalizedSeqs: number[];
};

export type TranscriptIntakeResult = {
  state: TranscriptIntakeState;
  // Non-null only when this event created an utterance.
  utterance: RawUtterance | null;
  // Why an event produced no utterance. Discards are reported rather than
  // silently dropped.
  discarded: null | "interim_after_final" | "duplicate_final" | "empty_text";
};

export function createTranscriptIntakeState(): TranscriptIntakeState {
  return { preview: null, finalizedSeqs: [] };
}

export function applyTranscriptEvent(
  state: TranscriptIntakeState,
  event: TranscriptEvent,
  mint: { id: UtteranceId; seq: number },
): TranscriptIntakeResult {
  const alreadyFinal = state.finalizedSeqs.includes(event.providerSeq);

  if (event.kind === "interim") {
    // A final already settled this sequence; a straggling interim must not
    // resurrect a preview for it.
    if (alreadyFinal) return { state, utterance: null, discarded: "interim_after_final" };
    return {
      state: { ...state, preview: { providerSeq: event.providerSeq, text: event.text } },
      utterance: null,
      discarded: null,
    };
  }

  // Applying the same final twice must be idempotent.
  if (alreadyFinal) return { state, utterance: null, discarded: "duplicate_final" };

  const clearedPreview = state.preview?.providerSeq === event.providerSeq ? null : state.preview;

  if (!event.text.trim()) {
    // Still mark the sequence finalized so a later interim for it is ignored.
    return {
      state: { preview: clearedPreview, finalizedSeqs: [...state.finalizedSeqs, event.providerSeq] },
      utterance: null,
      discarded: "empty_text",
    };
  }

  return {
    state: { preview: clearedPreview, finalizedSeqs: [...state.finalizedSeqs, event.providerSeq] },
    utterance: createRawUtterance(
      {
        id: mint.id,
        text: event.text,
        createdAt: event.at,
        provider: event.provider,
        ...(event.confidence === undefined ? {} : { audio: { confidence: event.confidence } }),
      },
      mint.seq,
    ),
    discarded: null,
  };
}
