import { describe, expect, it } from "vitest";
import { appendEvent, appendUtterance, createEventLog, createRawUtterance, recentUtterances, utterancesOf } from "./rawUtterance";

describe("rawUtterance", () => {
  it("keeps the text verbatim rather than normalizing the primary source", () => {
    const utterance = createRawUtterance(
      { id: "u1", text: "  では  Aで進めます  ", createdAt: 1, provider: "manual" },
      1,
    );
    expect(utterance.text).toBe("  では  Aで進めます  ");
  });

  it("records an unknown speaker as null instead of inventing one", () => {
    expect(createRawUtterance({ id: "u1", text: "a", createdAt: 1, provider: "web_speech" }, 1).speaker).toBeNull();
    expect(createRawUtterance({ id: "u2", text: "a", createdAt: 1, provider: "web_speech", speaker: "   " }, 1).speaker).toBeNull();
    expect(createRawUtterance({ id: "u3", text: "a", createdAt: 1, provider: "web_speech", speaker: " 鈴木 " }, 1).speaker).toBe("鈴木");
  });

  it("orders by seq, not by createdAt, when timestamps collide", () => {
    let log = createEventLog();
    const first = appendUtterance(log, { id: "u1", text: "先", createdAt: 500, provider: "manual" });
    const second = appendUtterance(first.log, { id: "u2", text: "後", createdAt: 500, provider: "manual" });
    expect([first.utterance.seq, second.utterance.seq]).toEqual([1, 2]);
    expect(utterancesOf(second.log).map((u) => u.text)).toEqual(["先", "後"]);
  });

  it("is append-only: appending does not mutate the previous log", () => {
    const log = createEventLog();
    const { log: next } = appendUtterance(log, { id: "u1", text: "a", createdAt: 1, provider: "manual" });
    expect(log.events).toHaveLength(0);
    expect(next.events).toHaveLength(1);

    const withCorrection = appendEvent(next, {
      kind: "human_correction",
      at: 2,
      correction: { id: "c1", at: 2, target: { utteranceId: "u1" }, axes: { role: "decision" }, note: null },
    });
    expect(next.events).toHaveLength(1);
    expect(withCorrection.events).toHaveLength(2);
  });

  it("normalizes every provider into the same utterance shape", () => {
    let log = createEventLog();
    for (const provider of ["manual", "replay", "web_speech", "external_stt"] as const) {
      log = appendUtterance(log, { id: `u-${provider}`, text: provider, createdAt: 1, provider }).log;
    }
    const providers = utterancesOf(log).map((u) => u.provider);
    expect(providers).toEqual(["manual", "replay", "web_speech", "external_stt"]);
    expect(utterancesOf(log).every((u) => typeof u.seq === "number" && typeof u.text === "string")).toBe(true);
  });

  it("returns only the rolling window, so the fast path cannot read the whole meeting", () => {
    let log = createEventLog();
    for (let index = 0; index < 30; index += 1) {
      log = appendUtterance(log, { id: `u${index}`, text: `発話${index}`, createdAt: index, provider: "manual" }).log;
    }
    const window = recentUtterances(log, 5);
    expect(window).toHaveLength(5);
    expect(window.map((u) => u.text)).toEqual(["発話25", "発話26", "発話27", "発話28", "発話29"]);
    expect(recentUtterances(log, 0)).toEqual([]);
  });
});
