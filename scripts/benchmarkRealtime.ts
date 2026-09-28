// Measures the legacy pipeline's per-utterance cost against the realtime
// budgets in src/semantic/realtimeBudget.ts (ADR 0023).
//
// This is a report, not a test: it always exits 0. Timing varies with machine
// and CI load, so a hard threshold here would be flaky. The number that matters
// is the *shape* -- whether a stage grows linearly with meeting length or
// quadratically -- and the meeting length at which a budget is first breached.
//
// Run before and after each migration phase and compare. Phase N must not make
// any stage's utilization worse at the same meeting length.

import fs from "fs";
import path from "path";
import { createTopicEngineStore } from "../src/hooks/topicEngineStore";
import { buildMeetingStateDashboard } from "../src/utils/meetingStateDashboard";
import { buildCurrentDiscussionState } from "../src/utils/currentDiscussionState";
import { buildMeetingProgress } from "../src/utils/meetingProgress";
import { classifyUtterance } from "../src/utils/utteranceClassification";
import { evaluateStage, firstBreachingLength, type RealtimeStage, type StageMeasurement } from "../src/semantic/realtimeBudget";

// Mixed real meeting speech (decisions, reports, options, fillers, references)
// cycled to reach each target length. Keeping the mix realistic matters: a
// corpus of only short acknowledgements would understate the cost.
const UTTERANCE_POOL = [
  "今日はイベント形式について決めます",
  "対戦ゲーム企画が上がっているんですけど、来場者が少ないときの集客が課題です",
  "スマホで集客しやすいので、対戦ゲーム形式で進めましょう",
  "対戦ゲーム形式を採用します",
  "Wi-Fi負荷は検証されていないので、事前に確認が必要かもしれません",
  "ランキング機能については、保留にしておきましょう",
  "鈴木さんがプロトタイプを来週金曜日までに作成します",
  "レビューはいつになりますか？",
  "そうですね",
  "レイテンシー削減が急務なんですけど、現在30%のユーザーが3秒以上待たされています",
  "昨日のスプリントタスクは完了しました。ただし、APIレスポンスが予想より遅くて、パフォーマンステストをやり直す必要があります",
  "話を戻すと、Wi-Fi負荷の件ですが",
];

const MEETING_LENGTHS = [100, 400, 800, 1600, 3200];
const RENDER_REPEATS = 5;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function timeAverage(run: () => unknown, repeats = RENDER_REPEATS): number {
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) run();
  return (performance.now() - started) / repeats;
}

type LengthResult = {
  utteranceCount: number;
  ingestP50Ms: number;
  ingestP95Ms: number;
  timelineMs: number;
  meetingStateMs: number;
  progressMapMs: number;
};

function measureLength(targetCount: number): LengthResult {
  const store = createTopicEngineStore();
  const ingestTimes: number[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const text = UTTERANCE_POOL[index % UTTERANCE_POOL.length];
    const started = performance.now();
    store.submitTranscript(text, "manual");
    ingestTimes.push(performance.now() - started);
  }

  const snapshot = store.getSnapshot();
  const engine = snapshot.engineState;

  // Timeline currently re-classifies every node whenever the node list changes,
  // so the per-utterance render cost is the whole-list cost.
  const timelineMs = timeAverage(() => snapshot.conversationTree.nodes.map((node) => classifyUtterance(node.originalText)));
  const meetingStateMs = timeAverage(() => {
    buildMeetingStateDashboard(engine.decisionGraph, snapshot.decisionSupport.materials, null);
    buildCurrentDiscussionState(engine.meetingGraph, engine.currentTopicId, engine.decisionGraph, snapshot.segmentArchive);
  });
  const progressMapMs = timeAverage(() =>
    buildMeetingProgress(snapshot.conversationTree, engine.decisionGraph, snapshot.segmentArchive, snapshot.discussionPrompts),
  );

  return {
    utteranceCount: targetCount,
    ingestP50Ms: percentile(ingestTimes, 0.5),
    ingestP95Ms: percentile(ingestTimes, 0.95),
    timelineMs,
    meetingStateMs,
    progressMapMs,
  };
}

// Maps raw measurements onto the budgeted stages. A stage is the user-visible
// wait, so it includes ingest: the Timeline cannot render before ingest returns.
// The stages are reported both split and as a total, because three stages can
// each sit inside their own budget while the sum the facilitator waits for does
// not.
function toStageMeasurements(result: LengthResult): StageMeasurement[] {
  const timelineRender = result.ingestP95Ms + result.timelineMs;
  const provisionalMeetingState = result.ingestP95Ms + result.meetingStateMs;
  return [
    { stage: "timelineRender", p95Ms: timelineRender, utteranceCount: result.utteranceCount },
    { stage: "fastSemantic", p95Ms: result.ingestP95Ms, utteranceCount: result.utteranceCount },
    { stage: "provisionalMeetingState", p95Ms: provisionalMeetingState, utteranceCount: result.utteranceCount },
    { stage: "progressMapRender", p95Ms: result.progressMapMs, utteranceCount: result.utteranceCount },
    // ingest is counted once, not once per panel.
    {
      stage: "totalVisibleUpdate",
      p95Ms: result.ingestP95Ms + result.timelineMs + result.meetingStateMs + result.progressMapMs,
      utteranceCount: result.utteranceCount,
    },
  ];
}

const results = MEETING_LENGTHS.map(measureLength);

console.log("\n=== Realtime Budget Benchmark (legacy pipeline) ===\n");
console.log("n = 会議の累積発話数。ingest は submitTranscript 1回の同期時間。");
console.log("progressMap は「流れ・次の検討」を開いているときだけ発生する。\n");
console.log("    n | ingest p50 | ingest p95 | timeline | meetingState | progressMap");
console.log("------+------------+------------+----------+--------------+------------");
for (const result of results) {
  const format = (value: number) => `${value.toFixed(1)}`.padStart(8);
  console.log(
    `${String(result.utteranceCount).padStart(5)} |${format(result.ingestP50Ms)}    |${format(result.ingestP95Ms)}    |` +
    `${format(result.timelineMs)}  |${format(result.meetingStateMs)}      |${format(result.progressMapMs)}`,
  );
}

console.log("\n--- Budget verdicts ---\n");
const stages: RealtimeStage[] = [
  "timelineRender",
  "fastSemantic",
  "provisionalMeetingState",
  "progressMapRender",
  "totalVisibleUpdate",
];
const allMeasurements = results.flatMap(toStageMeasurements);

for (const stage of stages) {
  const measurements = allMeasurements.filter((measurement) => measurement.stage === stage);
  const breach = firstBreachingLength(measurements);
  const longest = evaluateStage(measurements[measurements.length - 1]);
  const status = breach === null ? "OK" : `BREACH at n≈${breach}`;
  console.log(
    `${stage.padEnd(24)} budget ${String(longest.budgetMs).padStart(4)}ms  ` +
    `n=${longest.utteranceCount}: ${longest.p95Ms.toFixed(1)}ms ` +
    `(${(longest.utilization * 100).toFixed(0)}% of budget)  ${status}`,
  );
}

// progressMapRender only applies while that panel is open, so report its growth
// shape explicitly alongside the verdict above.
const progressGrowth = results.map((result) => `n=${result.utteranceCount}: ${result.progressMapMs.toFixed(1)}ms`).join("  ");
console.log(`\nprogressMapRender (applies only while that panel is open): ${progressGrowth}`);

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const outputPath = path.join(logsDir, "realtime-benchmark.json");
fs.writeFileSync(outputPath, JSON.stringify({ measuredAt: new Date().toISOString(), results, verdicts: allMeasurements.map(evaluateStage) }, null, 2));
console.log(`\nDetailed results saved to: ${outputPath}`);
