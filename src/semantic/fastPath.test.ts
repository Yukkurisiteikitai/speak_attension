import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyFastPathContext, runFastPath, FAST_PATH_CONTEXT_WINDOW } from "./fastPath";
import { createRawUtterance } from "./rawUtterance";
import type { RawUtterance } from "./types";

const utteranceOf = (text: string, id = "u1", seq = 1): RawUtterance =>
  createRawUtterance({ id, text, createdAt: 1_000, provider: "web_speech" }, seq);

describe("runFastPath", () => {
  it("produces one assertion per unit, with deterministic ids", () => {
    const first = runFastPath({ utterance: utteranceOf("スマホで集客しやすいので、対戦ゲーム形式で進めましょう"), context: emptyFastPathContext() });
    const second = runFastPath({ utterance: utteranceOf("スマホで集客しやすいので、対戦ゲーム形式で進めましょう"), context: emptyFastPathContext() });
    expect(first.units).toHaveLength(2);
    expect(first.assertions).toHaveLength(2);
    expect(first.units.map((unit) => unit.id)).toEqual(["u1#u0", "u1#u1"]);
    expect(second.units.map((unit) => unit.id)).toEqual(first.units.map((unit) => unit.id));
  });

  it("never produces a model-provenance assertion", () => {
    const result = runFastPath({ utterance: utteranceOf("対戦ゲーム形式を採用します"), context: emptyFastPathContext() });
    expect(result.assertions.every((assertion) => assertion.unit.axes.provenance === "rule")).toBe(true);
  });

  it("never produces a proximity relation", () => {
    const context = { ...emptyFastPathContext(), recentUtterances: [utteranceOf("課題は集客です", "u0", 0)] };
    const result = runFastPath({ utterance: utteranceOf("対戦ゲーム形式で進めましょう"), context });
    expect(result.relations.every((relation) => relation.basis !== "proximity")).toBe(true);
  });

  it("links an explicitly named alternative to the single earlier mention", () => {
    const context = { ...emptyFastPathContext(), recentUtterances: [utteranceOf("A案とB案を比べます", "u0", 0)] };
    const result = runFastPath({ utterance: utteranceOf("A案で進めます", "u2", 2), context });
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({ to: "u0#u0", basis: "named_reference", relation: "refines" });
  });

  it("links nothing when two earlier utterances name the same alternative", () => {
    const context = {
      ...emptyFastPathContext(),
      recentUtterances: [utteranceOf("A案を検討します", "u0", 0), utteranceOf("A案の課題は集客です", "u1", 1)],
    };
    const result = runFastPath({ utterance: utteranceOf("A案で進めます", "u2", 2), context });
    expect(result.relations).toHaveLength(0);
  });

  it("marks a leading pronoun as ambiguous instead of resolving it", () => {
    const context = { ...emptyFastPathContext(), recentUtterances: [utteranceOf("対戦ゲーム形式で進めましょう", "u0", 0)] };
    const result = runFastPath({ utterance: utteranceOf("それで進めましょう", "u1", 1), context });
    expect(result.units[0].axes.epistemic).toBe("ambiguous");
    expect(result.relations).toHaveLength(0);
  });

  it("yields no units for an utterance with no content", () => {
    const result = runFastPath({ utterance: utteranceOf("   "), context: emptyFastPathContext() });
    expect(result.units).toEqual([]);
    expect(result.assertions).toEqual([]);
  });

  it("cannot be handed the whole meeting: the input exposes only a bounded context", () => {
    // Structural guard for ADR 0023 §4. If someone widens the signature to take
    // the event log or a full utterance list, this fails.
    const source = readFileSync(new URL("./fastPath.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/MeetingEventLog/);
    expect(source).not.toMatch(/utterancesOf/);
    expect(FAST_PATH_CONTEXT_WINDOW).toBeLessThanOrEqual(50);
  });
});
