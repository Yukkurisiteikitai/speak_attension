import { describe, expect, it } from "vitest";
import { applyTranscriptEvent, createTranscriptIntakeState, type TranscriptEvent } from "./transcriptEvents";

const mint = { id: "u1", seq: 1 };
const interim = (providerSeq: number, text: string): TranscriptEvent =>
  ({ kind: "interim", provider: "web_speech", providerSeq, text, at: 100 });
const final = (providerSeq: number, text: string): TranscriptEvent =>
  ({ kind: "final", provider: "web_speech", providerSeq, text, at: 200 });

describe("transcript intake contract (ADR 0023 §7)", () => {
  it("an interim only updates the preview and creates no utterance", () => {
    const result = applyTranscriptEvent(createTranscriptIntakeState(), interim(1, "対戦ゲーム形"), mint);
    expect(result.utterance).toBeNull();
    expect(result.state.preview).toEqual({ providerSeq: 1, text: "対戦ゲーム形" });
    expect(result.state.finalizedSeqs).toEqual([]);
  });

  it("a final creates exactly one utterance", () => {
    const result = applyTranscriptEvent(createTranscriptIntakeState(), final(1, "対戦ゲーム形式を採用します"), mint);
    expect(result.utterance?.text).toBe("対戦ゲーム形式を採用します");
    expect(result.utterance?.seq).toBe(1);
    expect(result.utterance?.provider).toBe("web_speech");
  });

  it("a final replaces the interim preview for the same providerSeq", () => {
    const afterInterim = applyTranscriptEvent(createTranscriptIntakeState(), interim(1, "対戦ゲーム形"), mint);
    const afterFinal = applyTranscriptEvent(afterInterim.state, final(1, "対戦ゲーム形式を採用します"), mint);
    expect(afterFinal.state.preview).toBeNull();
  });

  it("keeps a preview that belongs to a different providerSeq", () => {
    const afterInterim = applyTranscriptEvent(createTranscriptIntakeState(), interim(2, "次の議題は"), mint);
    const afterFinal = applyTranscriptEvent(afterInterim.state, final(1, "前の発話です"), mint);
    expect(afterFinal.state.preview).toEqual({ providerSeq: 2, text: "次の議題は" });
  });

  it("discards an interim that arrives after the final for the same providerSeq", () => {
    const afterFinal = applyTranscriptEvent(createTranscriptIntakeState(), final(1, "採用します"), mint);
    const late = applyTranscriptEvent(afterFinal.state, interim(1, "採用しま"), mint);
    expect(late.discarded).toBe("interim_after_final");
    expect(late.state.preview).toBeNull();
    expect(late.state).toEqual(afterFinal.state);
  });

  it("applying the same final twice is idempotent", () => {
    const once = applyTranscriptEvent(createTranscriptIntakeState(), final(1, "採用します"), mint);
    const twice = applyTranscriptEvent(once.state, final(1, "採用します"), { id: "u2", seq: 2 });
    expect(twice.utterance).toBeNull();
    expect(twice.discarded).toBe("duplicate_final");
    expect(twice.state.finalizedSeqs).toEqual([1]);
  });

  it("an empty final creates no utterance but still closes the sequence", () => {
    const result = applyTranscriptEvent(createTranscriptIntakeState(), final(1, "   "), mint);
    expect(result.utterance).toBeNull();
    expect(result.discarded).toBe("empty_text");
    const late = applyTranscriptEvent(result.state, interim(1, "何か"), mint);
    expect(late.discarded).toBe("interim_after_final");
  });

  it("never lets an interim reach the event log across a whole recognition round", () => {
    let state = createTranscriptIntakeState();
    const created: string[] = [];
    const events: TranscriptEvent[] = [
      interim(1, "対戦"), interim(1, "対戦ゲーム"), interim(1, "対戦ゲーム形式を"),
      final(1, "対戦ゲーム形式を採用します"),
      interim(1, "対戦ゲーム形式を採用しま"),
    ];
    events.forEach((event, index) => {
      const result = applyTranscriptEvent(state, event, { id: `u${index}`, seq: index + 1 });
      state = result.state;
      if (result.utterance) created.push(result.utterance.text);
    });
    expect(created).toEqual(["対戦ゲーム形式を採用します"]);
  });
});
