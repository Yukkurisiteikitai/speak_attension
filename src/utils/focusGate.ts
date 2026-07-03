import type {
  FocusRelation,
  FocusState,
  ImportantMention,
  ResolvedReference,
  TopicScoreBreakdown,
  TopicGraphEdge,
  TopicGraphNode,
  UtteranceIntent,
} from "../types/topic";
import { mapIntentToImportanceType } from "./intentRules";

const NOISE_PATTERNS = ["そうですね", "はい", "なるほど", "了解", "うん", "そうです", "ですね"];

const SEMANTIC_ADJACENCY: Record<string, string[]> = {
  latency: ["asr", "ui", "graph", "model"],
  ui: ["latency", "graph", "topic-detection"],
  cost: ["model"],
  accuracy: ["model", "topic-detection", "asr"],
};

export type FocusGateInput = {
  text: string;
  focusState: FocusState;
  intent: UtteranceIntent;
  selectedTopicId: string | null;
  matchedTopicIds: string[];
  topicScores: TopicScoreBreakdown[];
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
  shouldChangeFocus: boolean;
  focusChangeCandidateTopicId: string | null;
  reason: string;
};

export function detectImportanceType(text: string): ImportantMention["type"] | null {
  if (["問題", "困る", "難しい", "懸念", "不足", "できない"].some((pattern) => text.includes(pattern))) return "problem";
  if (["危ない", "リスク", "危険", "不安", "まずい"].some((pattern) => text.includes(pattern))) return "risk";
  if (["あとで", "後で", "TODO", "ToDo", "やる", "確認", "見た方がいい"].some((pattern) => text.includes(pattern))) {
    return "todo";
  }
  if (["決める", "決めます", "決定", "判断", "方針", "結論"].some((pattern) => text.includes(pattern))) return "decision";
  if (["どう", "なぜ", "どこ", "いつ", "ですか", "ますか", "？", "?"].some((pattern) => text.includes(pattern))) return "question";
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
  const importanceType = mapIntentToImportanceType(input.intent) ?? detectImportanceType(input.text);
  const focusTopicId = input.focusState.focusTopicId;
  const hasFocus = Boolean(focusTopicId);
  const hasReferenceToFocus = input.resolvedReferences.some((reference) => reference.candidateTopicId === focusTopicId);
  const selectedIsFocus = Boolean(focusTopicId && input.selectedTopicId === focusTopicId);
  const matchedFocus = Boolean(focusTopicId && input.matchedTopicIds.includes(focusTopicId));
  const hasUnresolvedReference = input.unresolvedReferences.length > 0;
  const selectedScore = input.topicScores.find((score) => score.topicId === input.selectedTopicId) ?? null;
  const focusScore = input.topicScores.find((score) => score.topicId === focusTopicId) ?? null;
  const selectedHasDirectMatch = Boolean(selectedScore && (selectedScore.keywordScore > 0 || selectedScore.synonymScore > 0));

  if (isNoiseUtterance(input.text) || input.intent === "agreement") {
    if (matchedFocus || selectedIsFocus || hasReferenceToFocus) {
      return buildResult("on_focus", importanceType, true, false, false, false, null, "focus上の相槌として扱いました。");
    }
    return buildResult("off_topic_noise", importanceType, false, false, false, false, null, "短い相槌として扱いました。");
  }

  if (!hasFocus && !input.focusState.locked && input.selectedTopicId && selectedHasDirectMatch) {
    return buildResult(
      "on_focus",
      importanceType,
      true,
      true,
      false,
      true,
      input.selectedTopicId,
      "集中議題が未設定のため、最初に直接一致した議題をfocus候補にしました。",
    );
  }

  if (matchedFocus || selectedIsFocus || hasReferenceToFocus) {
    return buildResult("on_focus", importanceType, true, true, false, false, null, "focus議題の直接一致または参照先に一致しました。");
  }

  if (hasUnresolvedReference) {
    return buildResult(
      "uncertain",
      importanceType,
      false,
      false,
      false,
      false,
      null,
      "指示語はありますが、参照先を十分な信頼度で確定できません。",
    );
  }

  if (canAutoChangeFocus(input, selectedScore, focusScore)) {
    return buildResult(
      "on_focus",
      importanceType,
      true,
      true,
      false,
      true,
      input.selectedTopicId,
      "明示的な話題切り替えと強い直接一致があるため、focus変更候補にしました。",
    );
  }

  if (input.intent === "switch_topic" && input.focusState.locked && input.selectedTopicId && selectedHasDirectMatch) {
    const relatedTopicIds = getRelatedTopicIds(focusTopicId, input.edges);
    if (relatedTopicIds.has(input.selectedTopicId)) {
      return buildResult(
        "adjacent",
        importanceType,
        true,
        false,
        false,
        false,
        null,
        "focusはロック中のため変更せず、関連議題として軽く反映します。",
      );
    }
    return buildResult(
      "off_topic_important",
      importanceType,
      false,
      false,
      false,
      false,
      null,
      "focusはロック中のため変更せず、話題切り替え候補として記録します。",
    );
  }

  if (importanceType && hasFocus) {
    return buildResult(
      "off_topic_important",
      importanceType,
      false,
      false,
      false,
      false,
      null,
      "focus外ですが、問題・TODO・判断などの重要発話として記録します。",
    );
  }

  const relatedTopicIds = getRelatedTopicIds(focusTopicId, input.edges);
  if (input.matchedTopicIds.some((topicId) => relatedTopicIds.has(topicId))) {
    return buildResult(
      "adjacent",
      importanceType,
      true,
      false,
      false,
      false,
      null,
      "focusに隣接または関連する議題として軽く反映します。",
    );
  }

  if (input.intent === "correction" && selectedHasDirectMatch) {
    return buildResult("uncertain", importanceType, false, false, false, false, null, "訂正発話ですが、focusとの関係を確定できません。");
  }

  return buildResult("uncertain", importanceType, false, false, false, false, null, "focusとの関係を十分に判定できません。");
}

function canAutoChangeFocus(
  input: FocusGateInput,
  selectedScore: TopicScoreBreakdown | null,
  focusScore: TopicScoreBreakdown | null,
): boolean {
  if (input.focusState.locked) return false;
  if (!input.focusState.focusTopicId) return false;
  if (!input.selectedTopicId || input.selectedTopicId === input.focusState.focusTopicId) return false;
  if (input.intent !== "switch_topic") return false;
  if (input.unresolvedReferences.length > 0) return false;
  if (!selectedScore) return false;

  const hasStrongDirectMatch = selectedScore.keywordScore >= 1 || selectedScore.synonymScore >= 0.7;
  if (!hasStrongDirectMatch) return false;

  const currentFocusTotal = focusScore?.total ?? 0;
  return selectedScore.total >= currentFocusTotal + 0.7;
}

function buildResult(
  focusRelation: FocusRelation,
  importanceType: ImportantMention["type"] | null,
  shouldUpdateGraph: boolean,
  shouldUpdateCurrentTopic: boolean,
  shouldCreateNode: boolean,
  shouldChangeFocus: boolean,
  focusChangeCandidateTopicId: string | null,
  reason: string,
): FocusGateResult {
  return {
    focusRelation,
    focusAlignmentScore: scoreRelation(focusRelation),
    importanceType,
    shouldUpdateGraph,
    shouldUpdateCurrentTopic,
    shouldCreateNode,
    shouldChangeFocus,
    focusChangeCandidateTopicId,
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
