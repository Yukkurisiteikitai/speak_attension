import type { FocusState, TopicGraphEdge, TopicGraphNode, TopicScoreBreakdown, UtteranceIntent } from "../types/topic";

export const INITIAL_TOPIC_NODES: TopicGraphNode[] = [
  {
    id: "asr",
    type: "topic",
    position: { x: 0, y: 60 },
    data: {
      label: "ASR / 文字起こし",
      heat: 0,
      keywords: ["音声", "文字起こし", "STT", "ASR", "Whisper", "Deepgram", "OpenAI", "Realtime"],
      normalizedTerms: [],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "topic-detection",
    type: "topic",
    position: { x: 300, y: 40 },
    data: {
      label: "議題検知",
      heat: 0,
      keywords: ["議題", "トピック", "検知", "分類", "判定", "ノード", "既存", "新規"],
      normalizedTerms: [],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "graph",
    type: "topic",
    position: { x: 600, y: 60 },
    data: {
      label: "グラフ描画",
      heat: 0,
      keywords: ["グラフ", "描画", "React Flow", "ノード", "エッジ", "マインドマップ", "可視化"],
      normalizedTerms: [],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "ui",
    type: "topic",
    position: { x: 900, y: 60 },
    data: {
      label: "UI / 体験",
      heat: 0,
      keywords: ["UI", "画面", "体験", "Live感", "見やすい", "強調", "光る"],
      normalizedTerms: [],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "model",
    type: "topic",
    position: { x: 300, y: 260 },
    data: {
      label: "モデル選定",
      heat: 0,
      keywords: ["モデル", "LLM", "embedding", "埋め込み", "GPT", "Gemini", "Claude"],
      normalizedTerms: [],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "cost",
    type: "topic",
    position: { x: 600, y: 220 },
    data: {
      label: "コスト",
      heat: 0,
      keywords: ["コスト", "料金", "API", "安い", "高い"],
      normalizedTerms: ["API代", "使用量", "課金"],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "latency",
    type: "topic",
    position: { x: 600, y: 340 },
    data: {
      label: "速度",
      heat: 0,
      keywords: ["速度", "レイテンシ", "レイテンシー", "遅延", "リアルタイム", "速い", "遅い"],
      normalizedTerms: ["待ち時間", "反応", "もたつき", "ラグ", "重い", "遅れる"],
      lastTouchedAt: null,
      evidence: [],
    },
  },
  {
    id: "accuracy",
    type: "topic",
    position: { x: 600, y: 460 },
    data: {
      label: "精度",
      heat: 0,
      keywords: ["精度", "誤検知", "正確", "品質", "改善"],
      normalizedTerms: ["正確さ", "間違える", "ずれる", "認識ミス"],
      lastTouchedAt: null,
      evidence: [],
    },
  },
];

export const INITIAL_TOPIC_EDGES: TopicGraphEdge[] = [
  { id: "asr-topic", source: "asr", target: "topic-detection" },
  { id: "topic-graph", source: "topic-detection", target: "graph" },
  { id: "graph-ui", source: "graph", target: "ui" },
  { id: "model-cost", source: "model", target: "cost" },
  { id: "model-latency", source: "model", target: "latency" },
  { id: "model-accuracy", source: "model", target: "accuracy" },
  { id: "topic-model", source: "topic-detection", target: "model" },
];

export function normalizeForMatch(value: string): string {
  return value.trim().toLocaleLowerCase("ja-JP");
}

export function scoreTopic(text: string, node: TopicGraphNode): number {
  return findMatchedKeywords(text, node).length;
}

export function findMatchedKeywords(text: string, node: TopicGraphNode): string[] {
  const normalizedText = normalizeForMatch(text);
  return node.data.keywords.filter((keyword) => {
    const normalizedKeyword = normalizeForMatch(keyword);
    return normalizedKeyword && normalizedText.includes(normalizedKeyword);
  });
}

export function findMatchedSynonyms(text: string, node: TopicGraphNode, matchedKeywords = findMatchedKeywords(text, node)): string[] {
  const normalizedText = normalizeForMatch(text);
  const matchedKeywordSet = new Set(matchedKeywords.map((keyword) => normalizeForMatch(keyword)));
  return node.data.normalizedTerms.filter((term) => {
    const normalizedTerm = normalizeForMatch(term);
    return normalizedTerm && !matchedKeywordSet.has(normalizedTerm) && normalizedText.includes(normalizedTerm);
  });
}

export function scoreTopicBreakdown(input: {
  text: string;
  node: TopicGraphNode;
  focusState: FocusState;
  intent: UtteranceIntent;
  now: number;
}): TopicScoreBreakdown {
  const matchedKeywords = findMatchedKeywords(input.text, input.node);
  const matchedSynonyms = findMatchedSynonyms(input.text, input.node, matchedKeywords);
  const hasDirectMatch = matchedKeywords.length > 0 || matchedSynonyms.length > 0;
  const keywordScore = matchedKeywords.length;
  const synonymScore = Number((matchedSynonyms.length * 0.7).toFixed(2));
  const focusContextScore = hasDirectMatch && input.focusState.focusTopicId === input.node.id ? 0.5 : 0;
  const intentScore = scoreIntent(input.intent, hasDirectMatch, input.focusState.focusTopicId === input.node.id);
  const recencyScore =
    hasDirectMatch && input.node.data.lastTouchedAt && input.now - input.node.data.lastTouchedAt <= 60_000 ? 0.2 : 0;
  const total = Number((keywordScore + synonymScore + focusContextScore + intentScore + recencyScore).toFixed(2));

  return {
    topicId: input.node.id,
    label: input.node.data.label,
    total,
    keywordScore,
    synonymScore,
    focusContextScore,
    intentScore,
    recencyScore,
    matchedKeywords,
    matchedSynonyms,
    reason: buildScoreReason({
      matchedKeywords,
      matchedSynonyms,
      intent: input.intent,
      focusContextScore,
      recencyScore,
    }),
  };
}

export function sortTopicScores<T extends Pick<TopicScoreBreakdown, "total" | "keywordScore" | "synonymScore"> & { index: number }>(
  scores: T[],
): T[] {
  return [...scores].sort(
    (a, b) => b.total - a.total || b.keywordScore - a.keywordScore || b.synonymScore - a.synonymScore || a.index - b.index,
  );
}

function scoreIntent(intent: UtteranceIntent, hasDirectMatch: boolean, isFocus: boolean): number {
  if (!hasDirectMatch) return 0;
  if (intent === "switch_topic" && !isFocus) return 0.4;
  if (["question", "concern", "todo", "decision"].includes(intent)) return 0.3;
  return 0;
}

function buildScoreReason(input: {
  matchedKeywords: string[];
  matchedSynonyms: string[];
  intent: UtteranceIntent;
  focusContextScore: number;
  recencyScore: number;
}): string {
  const parts: string[] = [];
  if (input.matchedKeywords.length) parts.push(`keyword: ${input.matchedKeywords.join(", ")}`);
  if (input.matchedSynonyms.length) parts.push(`synonym: ${input.matchedSynonyms.join(", ")}`);
  if (input.intent !== "unknown") parts.push(`intent: ${input.intent}`);
  if (input.focusContextScore > 0) parts.push("focus context");
  if (input.recencyScore > 0) parts.push("recent topic");
  return parts.join(" / ") || "no direct match";
}

export function buildUnknownTopicLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 18);
}

export function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
