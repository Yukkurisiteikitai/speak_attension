// Run in the Vite dev page via import("/scripts/evaluateMeetingMinutesBrowser.js").
// Copy this script into the baseline checkout to run the same cases there.
import { createTopicEngineStore } from "../src/hooks/topicEngineStore";
import { entriesOfKind } from "../src/semantic/canonicalReducer";
import { buildTimelineProjection } from "../src/semantic/timelineProjection";
import { utterancesOf } from "../src/semantic/rawUtterance";

const cases = [
  { id: "schedule", lines: [["田中", "次回レビューは木曜15時にします"], ["佐藤", "はい、その時間で確定です"]],
    valid: [["schedule", "次回レビュー"]] },
  { id: "tentative-release", lines: ["たぶん金曜に本番公開できると思います", "QAの結果を見てからですね"], valid: [] },
  { id: "withdrawal", lines: ["A案を採用します", "今の発言は撤回します"], valid: [] },
  { id: "decision", lines: ["B案を採用します"], valid: [["decision", "B案を採用"]] },
  { id: "two-tasks", lines: [["鈴木", "私が金曜日までに資料を作成します。私は月曜日までに原稿を提出します"]],
    valid: [["action", "私が金曜日"], ["action", "私は月曜日"]] },
  { id: "authority", lines: ["予算100万円に決定します", "責任者に確認しましょう"], valid: [] },
  { id: "condition", lines: ["C案を採用します", "QAの結果を見てからですね"], valid: [] },
  { id: "delegated-task", lines: ["佐藤さんが金曜日までに原稿を提出します"],
    valid: [["action", "佐藤さんが金曜日"]] },
];

function submit(store, phrase, index) {
  if (typeof phrase === "string") store.submitTranscript(phrase, "manual");
  else store.submitTimedTranscript({
    id: "evaluation-" + index, speaker: phrase[0], text: phrase[1], source: "manual_replay",
    startMs: index * 1_000, endMs: index * 1_000 + 900,
  });
}

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const quantile = (fraction) => Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3));
  return { p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
}

const matches = ([kind, prefix], item) => item.kind === kind && item.title.startsWith(prefix);

export async function evaluateMeetingMinutesBrowser({ baseline = false } = {}) {
  const project = baseline ? null : (await import(/* @vite-ignore */ "/src/semantic/meetingMinutesProjection.ts")).projectMeetingMinutes;
  const timeProjection = [];
  const timeIngest = [];
  const timeFinish = [];
  const observations = [];

  for (const scenario of cases) {
    const store = createTopicEngineStore();
    scenario.lines.forEach((line, i) => submit(store, line, i));
    store.finishMeeting?.();
    const { semantic, engineState } = store.getSnapshot();
    const raw = new Map(utterancesOf(semantic.log).map((entry) => [entry.id, entry]));
    const minutes = project?.(engineState.meetingGraph.meetingId, semantic.canonical, semantic.log);
    const extracted = project ? minutes.items.filter((item) => item.semanticState === "agreed")
      : ["decision", "action"].flatMap((kind) => entriesOfKind(semantic.canonical, kind))
        .map((entry) => ({ title: entry.label, kind: entry.kind, refs: entry.evidence.utteranceIds }));
    const recorded = project ? minutes.recorded : extracted;
    observations.push({
      id: scenario.id,
      expected: scenario.valid.length,
      trueExtractions: scenario.valid.filter((expected) => extracted.some((item) => matches(expected, item))).length,
      falseExtractions: extracted.filter((item) => !scenario.valid.some((expected) => matches(expected, item))).length,
      recorded: recorded.length,
      falseCommitments: recorded.filter((item) => !scenario.valid.some((expected) => matches(expected, item))).length,
      requiresReview: minutes?.pending.length ?? null,
      trace: {
        total: minutes?.items.length ?? extracted.length,
        hasUtterance: minutes ? minutes.items.filter((item) => item.evidenceRefs.every((ref) => raw.has(ref.utteranceId))).length
          : extracted.filter((item) => item.refs.every((id) => raw.has(id))).length,
        hasExactSpan: minutes ? minutes.items.filter((item) => item.evidenceRefs.every((ref) =>
          raw.get(ref.utteranceId)?.text.slice(ref.startOffset, ref.endOffset) === ref.text)).length : null,
      },
    });
  }

  for (let run = 0; run < 8; run += 1) {
    const store = createTopicEngineStore();
    const sample = cases.flatMap((scenario) => scenario.lines);
    for (let i = 0; i < 100; i += 1) {
      const start = performance.now();
      submit(store, sample[i % sample.length], i);
      if (run !== 0) timeIngest.push(performance.now() - start);
    }
    const start = performance.now();
    store.finishMeeting?.();
    if (run !== 0 && project) timeFinish.push(performance.now() - start);
    const { semantic, engineState } = store.getSnapshot();
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      const minutes = project?.(engineState.meetingGraph.meetingId, semantic.canonical, semantic.log);
      buildTimelineProjection({ ...semantic, minutesItems: minutes?.items });
      if (run !== 0) timeProjection.push(performance.now() - start);
    }
  }

  return {
    observations, ingest: stats(timeIngest), projection: stats(timeProjection),
    finish: timeFinish.length ? stats(timeFinish) : null,
  };
}
