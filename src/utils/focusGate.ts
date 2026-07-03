import type {
  FocusRelation,
  FocusState,
  ImportantMention,
  ResolvedReference,
  TopicGraphEdge,
  TopicGraphNode,
} from "../types/topic";

const NOISE_PATTERNS = ["そうですね", "はい", "なるほど", "了解", "うん", "そうです", "ですね"];
const IMPORTANT_PATTERNS: Record<ImportantMention["type"], string[]> = {
  problem: ["問題", "困る", "難しい", "懸念", "不足", "できない"],
  risk: ["危ない", "リスク", "危険", "不安", "まずい"],
  todo: ["あとで", "後で", "TODO", "ToDo", "やる", "確認", "見た方がいい"],
  decision: ["決める", "決めます", "決定", "判断", "方針", "結論"],
  question: ["どう", "なぜ", "どこ", "いつ", "ですか", "ますか", "？", "?"],
};

const SEMANTIC_ADJACENCY: Record<string, string[]> = {
  latency: ["asr", "ui", "graph", "model"],
  ui: ["latency", "graph", "topic-detection"],
  cost: ["model"],
  accuracy: ["model", "topic-detection", "asr"],
};

export type FocusGateInput = {
  text: string;
  focusState: FocusState;
  selectedTopicId: string | null;
  matchedTopicIds: string[];
  resolvedReferences: ResolvedReference[];
  unresolvedReferences: string[];
  edges: TopicGraphEdge[];
  nodes: TopicGraphNode[];
};

export type FocusGateResult = {
  focusRelation: FocusRelation;
  focusAlignmentScore: number;
  importanceType: ImportantMention["type"] | null;
  shouldUpdateGraph: boolean;
  shouldUpdateCurrentTopic: boolean;
  shouldCreateNode: boolean;
  reason: string;
};

export function detectImportanceType(text: string): ImportantMention["type"] | null {
  for (const [type, patterns] of Object.entries(IMPORTANT_PATTERNS)) {
    if (patterns.some((pattern) => text.includes(pattern))) return type as ImportantMention["type"];
  }
  return null;
}

export function isNoiseUtterance(text: string): boolean {
  const cleanText = text.replace(/\s+/g, "");
  return cleanText.length <= 8 && NOISE_PATTERNS.some((pattern) => cleanText.includes(pattern));
}

export function getRelatedTopicIds(topicId: string | null, edges: TopicGraphEdge[]): Set<string> {
  const related = new Set<string>();
  if (!topicId) return related;

  for (const edge of edges) {
    if (edge.source === topicId) related.add(edge.target);
    if (edge.target === topicId) related.add(edge.source);
  }

  for (const semanticTopicId of SEMANTIC_ADJACENCY[topicId] ?? []) {
    related.add(semanticTopicId);
  }

  return related;
}

export function evaluateFocusGate(input: FocusGateInput): FocusGateResult {
  const importanceType = detectImportanceType(input.text);
  const focusTopicId = input.focusState.focusTopicId;
  const hasFocus = Boolean(focusTopicId);
  const hasReferenceToFocus = input.resolvedReferences.some((reference) => reference.candidateTopicId === focusTopicId);
  const selectedIsFocus = Boolean(focusTopicId && input.selectedTopicId === focusTopicId);
  const matchedFocus = Boolean(focusTopicId && input.matchedTopicIds.includes(focusTopicId));
  const hasUnresolvedReference = input.unresolvedReferences.length > 0;

  if (isNoiseUtterance(input.text)) {
    return buildResult("off_topic_noise", importanceType, false, false, false, "短い相槌として扱いました。");
  }

  if (!hasFocus && input.selectedTopicId) {
    return buildResult("on_focus", importanceType, true, true, false, "集中議題が未設定のため、最初に検知した議題をfocusにしました。");
  }

  if (matchedFocus || selectedIsFocus || hasReferenceToFocus) {
    return buildResult("on_focus", importanceType, true, true, false, "focus議題のキーワードまたは参照先に一致しました。");
  }

  if (hasUnresolvedReference) {
    return buildResult("uncertain", importanceType, false, false, false, "指示語はありますが、参照先を十分な信頼度で確定できません。");
  }

  if (importanceType && hasFocus) {
    return buildResult("off_topic_important", importanceType, false, false, false, "focus外ですが、問題・TODO・判断などの重要発話として記録します。");
  }

  const relatedTopicIds = getRelatedTopicIds(focusTopicId, input.edges);
  if (input.matchedTopicIds.some((topicId) => relatedTopicIds.has(topicId))) {
    return buildResult("adjacent", importanceType, true, false, false, "focusに隣接または関連する議題として軽く反映します。");
  }

  return buildResult("uncertain", importanceType, false, false, false, "focusとの関係を十分に判定できません。");
}

function buildResult(
  focusRelation: FocusRelation,
  importanceType: ImportantMention["type"] | null,
  shouldUpdateGraph: boolean,
  shouldUpdateCurrentTopic: boolean,
  shouldCreateNode: boolean,
  reason: string,
): FocusGateResult {
  return {
    focusRelation,
    focusAlignmentScore: scoreRelation(focusRelation),
    importanceType,
    shouldUpdateGraph,
    shouldUpdateCurrentTopic,
    shouldCreateNode,
    reason,
  };
}

function scoreRelation(relation: FocusRelation): number {
  switch (relation) {
    case "on_focus":
      return 1;
    case "adjacent":
      return 0.65;
    case "off_topic_important":
      return 0.35;
    case "uncertain":
      return 0.25;
    case "off_topic_noise":
      return 0.1;
  }
}
