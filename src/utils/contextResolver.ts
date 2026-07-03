import type { ConversationContext, ResolvedReference } from "../types/topic";

const REFERENCE_PHRASES = [
  "さっきの話",
  "前のやつ",
  "この話",
  "その件",
  "となると",
  "それら",
  "それで",
  "だから",
  "こっち",
  "そっち",
  "これ",
  "それ",
  "あれ",
];

const PREVIOUS_CONTEXT_PHRASES = new Set(["さっきの話", "前のやつ", "あれ"]);
const CAUSAL_CONTEXT_PHRASES = new Set(["それで", "だから", "となると"]);

export function detectReferencePhrases(text: string): string[] {
  return REFERENCE_PHRASES.filter((phrase) => text.includes(phrase));
}

export function resolveReferences(text: string, context: ConversationContext): ResolvedReference[] {
  return detectReferencePhrases(text).map((phrase) => resolveReferencePhrase(phrase, context));
}

function resolveReferencePhrase(phrase: string, context: ConversationContext): ResolvedReference {
  const recentTopicIds = context.recentTopicIds.filter(Boolean);
  const previousTopicId = recentTopicIds.find((topicId) => topicId !== context.activeTopicId) ?? recentTopicIds[0] ?? null;

  if (PREVIOUS_CONTEXT_PHRASES.has(phrase)) {
    if (previousTopicId) {
      return {
        phrase,
        candidateTopicId: previousTopicId,
        confidence: 0.68,
        reason: "直近の議題履歴から、現在より少し前に出た議題を候補にしました。",
      };
    }
    return {
      phrase,
      candidateTopicId: null,
      confidence: 0.28,
      reason: "前方参照を示す表現ですが、参照できる過去議題がまだありません。",
    };
  }

  if (CAUSAL_CONTEXT_PHRASES.has(phrase)) {
    if (context.activeTopicId) {
      return {
        phrase,
        candidateTopicId: context.activeTopicId,
        confidence: 0.62,
        reason: "接続表現なので、現在の議題から続く発話として扱いました。",
      };
    }
    return {
      phrase,
      candidateTopicId: previousTopicId,
      confidence: previousTopicId ? 0.52 : 0.24,
      reason: previousTopicId
        ? "接続表現ですが現在議題がないため、直近議題を弱い候補にしました。"
        : "接続表現ですが、候補になる議題履歴がありません。",
    };
  }

  if (context.activeTopicId) {
    return {
      phrase,
      candidateTopicId: context.activeTopicId,
      confidence: 0.72,
      reason: "現在アクティブな議題を指している可能性が高いと判定しました。",
    };
  }

  if (previousTopicId) {
    return {
      phrase,
      candidateTopicId: previousTopicId,
      confidence: 0.5,
      reason: "現在議題がないため、直近議題を弱い候補にしました。",
    };
  }

  return {
    phrase,
    candidateTopicId: null,
    confidence: 0.2,
    reason: "指示語は検知しましたが、参照できる文脈がまだありません。",
  };
}
