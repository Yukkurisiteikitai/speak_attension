import type { AnalyzedSegment, FocusState, TopicGap, TopicNode } from "../types/topic";

export type ReaderGuide = {
  summary: string;
  unknowns: string[];
  hints: string[];
};

type BuildReaderGuideOptions = {
  currentTopic: TopicNode | null;
  currentTopicGaps: TopicGap[];
  focusState: FocusState;
  latestSegment: AnalyzedSegment | null;
};

function buildSummary({ currentTopic, focusState, latestSegment }: BuildReaderGuideOptions): string {
  if (!latestSegment && !currentTopic) {
    return "まだ会話が入っていないため、議題も不足情報も表示されていません。まず1つ発話が入ると、この画面の意味が立ち上がります。";
  }

  if (!currentTopic) {
    return "直近の発話は受け取っていますが、まだ安定した議題としてまとまっていません。話題名として拾える表現が増えると Current Topic が出ます。";
  }

  const relationLabel =
    focusState.focusSetBy === "manual"
      ? "手動で見ている議題です"
      : latestSegment?.analysis.reason === "new meeting topic created from transcript phrase"
        ? "直近の発話から新しく立ち上がった議題です"
        : "会話の流れから自動で選ばれた中心議題です";

  return `今の中心は「${currentTopic.title}」で、${relationLabel}。`;
}

function buildUnknowns({ currentTopic, currentTopicGaps, latestSegment }: BuildReaderGuideOptions): string[] {
  const unknowns: string[] = [];

  if (!currentTopic) {
    unknowns.push("まだ『何について話しているか』を1つの議題として確定できていません。");
  }

  if (latestSegment?.analysis.unresolvedReferences.length) {
    unknowns.push(
      `直近の発話にある ${latestSegment.analysis.unresolvedReferences.map((phrase) => `「${phrase}」`).join("、")} が、どの議題を指すか判定できていません。`,
    );
  }

  currentTopicGaps.slice(0, 3).forEach((gap) => {
    unknowns.push(`「${gap.title}」: ${gap.detail}`);
  });

  if (!unknowns.length) {
    unknowns.push("この議題について、現時点では大きな不足は検出されていません。");
  }

  return unknowns;
}

function buildHints({ currentTopic, currentTopicGaps }: BuildReaderGuideOptions): string[] {
  const hints = [
    "Current Topic は、いま会話の中心だと判断している議題です。",
    "Coverage は、その議題で『決定・理由・担当・期限』などが会話に出たかをチェックしています。",
    "Current Gaps は、初見の人が後から見たときに説明が足りなくなる点を優先表示しています。",
  ];

  if (currentTopic && currentTopicGaps.length) {
    hints.push("Gap が残っている間は、議題名が分かっても意思決定の背景や宿題が不足している可能性があります。");
  }

  return hints;
}

export function buildReaderGuide(options: BuildReaderGuideOptions): ReaderGuide {
  return {
    summary: buildSummary(options),
    unknowns: buildUnknowns(options),
    hints: buildHints(options),
  };
}
