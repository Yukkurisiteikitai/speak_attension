import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTimelineProjection, type TimelineProjectionInput } from "./timelineProjection";
import { appendUtterance, createEventLog, recentUtterances, type MeetingEventLog } from "./rawUtterance";
import { emptyFastPathContext, runFastPath, FAST_PATH_CONTEXT_WINDOW } from "./fastPath";
import { createCanonicalState, reduceCanonical } from "./canonicalReducer";
import type { CanonicalMeetingState, HumanCorrection, SemanticAssertion } from "./types";

// Builds the same state the store will hold, so the projection is tested against
// real fast-path output rather than hand-written assertions.
function ingest(texts: string[]): TimelineProjectionInput {
  let log: MeetingEventLog = createEventLog();
  let canonical: CanonicalMeetingState = createCanonicalState();
  const assertions: SemanticAssertion[] = [];

  texts.forEach((text, index) => {
    const appended = appendUtterance(log, { id: `u${index}`, text, createdAt: 1_000 + index, provider: "manual", speaker: "話者A" });
    log = appended.log;
    const result = runFastPath({
      utterance: appended.utterance,
      context: { ...emptyFastPathContext(), recentUtterances: recentUtterances(log, FAST_PATH_CONTEXT_WINDOW) },
    });
    assertions.push(...result.assertions);
    canonical = reduceCanonical(canonical, {
      kind: "units_asserted", at: appended.utterance.createdAt, utterance: appended.utterance, assertions: result.assertions,
    }).state;
  });

  return { log, assertions, corrections: [], canonical };
}

describe("buildTimelineProjection", () => {
  it("does not re-interpret: no classifier or regex in the projection", () => {
    // The architectural point of Phase 2. If someone reintroduces classification
    // here, the Timeline is re-deriving meaning again and this fails.
    const source = readFileSync(new URL("./timelineProjection.ts", import.meta.url), "utf8");
    // Comments are stripped first: the header deliberately names the classifier
    // it replaces, and that prose must not fail its own check.
    const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).not.toContain("../utils/utteranceClassification");
    expect(imports).not.toContain("../utils/conversationTree");
    expect(code).not.toMatch(/classifyUtterance/);
    // Stronger form: the projection depends on no legacy interpretation module
    // at all, only on the semantic core it projects.
    expect(imports.filter((specifier) => specifier.startsWith("../utils/"))).toEqual([]);
    expect(imports.every((specifier) => specifier.startsWith("./"))).toBe(true);
  });

  it("projects one row per utterance, in seq order, keeping the raw wording", () => {
    const rows = buildTimelineProjection(ingest(["今日はイベント形式について決めます", "対戦ゲーム形式を採用します"]));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(rows[0].text).toBe("今日はイベント形式について決めます");
    expect(rows[0].speaker).toBe("話者A");
  });

  it("shows a multi-meaning utterance as several units under one row", () => {
    const rows = buildTimelineProjection(ingest([
      "昨日のスプリントタスクは完了しました。ただし、APIレスポンスが予想より遅くて、パフォーマンステストをやり直す必要があります",
    ]));
    expect(rows[0].units).toHaveLength(3);
    expect(rows[0].units.map((unit) => unit.text)).toEqual([
      "昨日のスプリントタスクは完了しました。",
      "ただし、APIレスポンスが予想より遅くて、",
      "パフォーマンステストをやり直す必要があります",
    ]);
  });

  it("carries the promoted kind and basis, so the UI can distinguish a rule reading from a confirmation", () => {
    const rows = buildTimelineProjection(ingest(["対戦ゲーム形式を採用します"]));
    expect(rows[0].units[0].promotion).toEqual({ kind: "decision", basis: "rule_explicit" });
  });

  it("marks an agenda item as promoted to topic, not decision", () => {
    const rows = buildTimelineProjection(ingest(["今日は今四半期のロードマップを確定します"]));
    expect(rows[0].units[0].promotion?.kind).not.toBe("decision");
  });

  it("applies a human correction per axis and leaves the other axes alone", () => {
    const input = ingest(["鈴木さんがプロトタイプを来週金曜日までに作成します"]);
    const unitId = input.assertions[0].unit.id;
    const before = buildTimelineProjection(input).flatMap((row) => row.units)[0];

    const corrections: HumanCorrection[] = [
      { id: "c1", at: 5_000, target: { utteranceId: "u0", unitId }, axes: { role: "option" }, note: "実際は候補の一つ" },
    ];
    const after = buildTimelineProjection({ ...input, corrections }).flatMap((row) => row.units)[0];

    expect(after.axes.role).toBe("option");
    expect(after.axes.commitment).toBe(before.axes.commitment);
    expect(after.humanOverriddenAxes).toEqual(["role"]);
  });

  it("flags the row as corrected and reports the disagreement instead of hiding it", () => {
    const input = ingest(["鈴木さんがプロトタイプを来週金曜日までに作成します"]);
    const unitId = input.assertions[0].unit.id;
    const corrections: HumanCorrection[] = [
      { id: "c1", at: 5_000, target: { utteranceId: "u0", unitId }, axes: { role: "option" }, note: null },
    ];
    const rows = buildTimelineProjection({ ...input, corrections });
    expect(rows[0].isCorrected).toBe(true);
    expect(rows[0].units[0].conflictingAxes).toEqual(["role"]);
  });

  it("keeps a human correction when the utterance is re-parsed", () => {
    // The defect this replaces: corrections lived in component state, so any
    // re-render or unmount discarded them.
    const first = ingest(["鈴木さんがプロトタイプを来週金曜日までに作成します"]);
    const unitId = first.assertions[0].unit.id;
    const corrections: HumanCorrection[] = [
      { id: "c1", at: 5_000, target: { utteranceId: "u0", unitId }, axes: { role: "option" }, note: null },
    ];
    // Re-ingesting produces fresh assertions with the same deterministic ids.
    const reparsed = ingest(["鈴木さんがプロトタイプを来週金曜日までに作成します"]);
    const rows = buildTimelineProjection({ ...reparsed, corrections });
    expect(rows[0].units[0].axes.role).toBe("option");
  });

  it("returns an empty projection for an empty meeting", () => {
    expect(buildTimelineProjection(ingest([]))).toEqual([]);
  });

  it("omits units for an utterance with no content rather than inventing a row shape", () => {
    const rows = buildTimelineProjection(ingest(["   "]));
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toEqual([]);
  });
});
