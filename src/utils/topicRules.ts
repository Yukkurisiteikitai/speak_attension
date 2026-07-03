import type { TopicGraphEdge, TopicGraphNode } from "../types/topic";

export const INITIAL_TOPIC_NODES: TopicGraphNode[] = [
  {
    id: "asr",
    type: "topic",
    position: { x: 0, y: 60 },
    data: {
      label: "ASR / 文字起こし",
      heat: 0,
      keywords: ["音声", "文字起こし", "STT", "ASR", "Whisper", "Deepgram", "OpenAI", "Realtime"],
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
      keywords: ["速度", "レイテンシ", "遅延", "リアルタイム", "速い", "遅い"],
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
  const normalizedText = normalizeForMatch(text);
  return node.data.keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalizeForMatch(keyword);
    return normalizedKeyword && normalizedText.includes(normalizedKeyword) ? score + 1 : score;
  }, 0);
}

export function buildUnknownTopicLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 18);
}

export function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
