import { describe, expect, it } from "vitest";
import { createCanonicalState, entriesOfKind, reduceCanonical } from "./canonicalReducer";
import { runFastPath, emptyFastPathContext } from "./fastPath";
import { createRawUtterance } from "./rawUtterance";
import type { SemanticEvent } from "./types";

const utterance = (text: string, id = "u1", seq = 1) =>
  createRawUtterance({ id, text, createdAt: 1_000, provider: "manual" }, seq);

function assertEvent(text: string, id = "u1", seq = 1): SemanticEvent {
  const raw = utterance(text, id, seq);
  const { assertions } = runFastPath({ utterance: raw, context: emptyFastPathContext() });
  return { kind: "units_asserted", at: raw.createdAt, utterance: raw, assertions };
}

describe("reduceCanonical", () => {
  it("reports only the changed entries, not the whole state", () => {
    const first = reduceCanonical(createCanonicalState(), assertEvent("対戦ゲーム形式を採用します", "u1", 1));
    const second = reduceCanonical(first.state, assertEvent("課題は集客です", "u2", 2));
    expect(second.changedEntityIds.every((id) => id.startsWith("u2#"))).toBe(true);
    expect(second.state.entries.length).toBeGreaterThan(first.state.entries.length);
  });

  it("is idempotent: applying the same event twice does not double-count", () => {
    const event = assertEvent("対戦ゲーム形式を採用します");
    const once = reduceCanonical(createCanonicalState(), event);
    const twice = reduceCanonical(once.state, event);
    expect(twice.state.entries).toHaveLength(once.state.entries.length);
    expect(entriesOfKind(twice.state, "decision")).toHaveLength(entriesOfKind(once.state, "decision").length);
  });

  it("bumps entityRevision when an entry is re-derived, so a stale refinement can be detected", () => {
    const event = assertEvent("対戦ゲーム形式を採用します");
    const once = reduceCanonical(createCanonicalState(), event);
    const twice = reduceCanonical(once.state, event);
    expect(twice.state.entries[0].entityRevision).toBe(once.state.entries[0].entityRevision + 1);
  });

  it("does not rebuild from scratch: earlier entries keep their identity", () => {
    const first = reduceCanonical(createCanonicalState(), assertEvent("対戦ゲーム形式を採用します", "u1", 1));
    const firstId = first.state.entries[0].id;
    const firstRevision = first.state.entries[0].entityRevision;
    const second = reduceCanonical(first.state, assertEvent("課題は集客です", "u2", 2));
    const carried = second.state.entries.find((entry) => entry.id === firstId);
    expect(carried?.entityRevision).toBe(firstRevision);
  });

  it("promotes only through the policy: an entry always carries a basis and a policy version", () => {
    const result = reduceCanonical(createCanonicalState(), assertEvent("対戦ゲーム形式を採用します"));
    for (const entry of result.state.entries) {
      expect(["provisional", "rule_explicit", "human_confirmed"]).toContain(entry.basis);
      expect(entry.promotedBy.policyVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("human confirmation upgrades the basis of one entry", () => {
    const promoted = reduceCanonical(createCanonicalState(), assertEvent("課題は集客です"));
    const target = promoted.state.entries[0];
    const confirmed = reduceCanonical(promoted.state, { kind: "human_confirmation", at: 2_000, entityId: target.id });
    expect(confirmed.state.entries.find((entry) => entry.id === target.id)?.basis).toBe("human_confirmed");
    expect(confirmed.changedEntityIds).toEqual([target.id]);
  });

  it("human rejection removes the entry", () => {
    const promoted = reduceCanonical(createCanonicalState(), assertEvent("課題は集客です"));
    const target = promoted.state.entries[0];
    const rejected = reduceCanonical(promoted.state, { kind: "human_rejection", at: 2_000, entityId: target.id });
    expect(rejected.state.entries.find((entry) => entry.id === target.id)).toBeUndefined();
  });

  it("a correction bumps the affected entries so a refinement built on the old reading is stale", () => {
    const promoted = reduceCanonical(createCanonicalState(), assertEvent("課題は集客です"));
    const before = promoted.state.entries[0].entityRevision;
    const corrected = reduceCanonical(promoted.state, {
      kind: "human_correction",
      at: 2_000,
      correction: { id: "c1", at: 2_000, target: { utteranceId: "u1" }, axes: { role: "option" }, note: null },
    });
    expect(corrected.state.entries[0].entityRevision).toBe(before + 1);
  });

  it("indexes entries by utterance and by kind", () => {
    const result = reduceCanonical(createCanonicalState(), assertEvent("対戦ゲーム形式を採用します"));
    expect(result.state.byUtteranceId["u1"]).toBeDefined();
    expect(result.state.byKind.decision.length + result.state.byKind.unresolved.length).toBeGreaterThan(0);
  });
});
