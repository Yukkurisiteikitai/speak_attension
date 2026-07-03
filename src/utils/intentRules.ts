import type { ImportantMention, UtteranceIntent } from "../types/topic";

const INTENT_PATTERNS: Array<{ intent: UtteranceIntent; patterns: string[] }> = [
  { intent: "switch_topic", patterns: ["話を戻すと", "戻ると", "別件", "次に", "話を変える", "切り替える"] },
  { intent: "correction", patterns: ["いや違う", "違います", "そうではなく", "訂正", "修正"] },
  { intent: "todo", patterns: ["後で見る", "あとで見る", "確認する", "やります", "対応", "TODO", "ToDo"] },
  { intent: "decision", patterns: ["決めます", "決める", "決定", "方針", "結論"] },
  { intent: "concern", patterns: ["問題", "懸念", "リスク", "不安", "困る", "難しい", "まずい"] },
  { intent: "question", patterns: ["どうしますか", "ですか", "ますか", "なぜ", "どこ", "いつ", "？", "?"] },
  { intent: "agreement", patterns: ["そうですね", "はい", "なるほど", "了解", "うん"] },
];

export function detectUtteranceIntent(text: string): UtteranceIntent {
  const cleanText = text.replace(/\s+/g, "");
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((pattern) => cleanText.includes(pattern.replace(/\s+/g, "")))) return intent;
  }
  return "unknown";
}

export function mapIntentToImportanceType(intent: UtteranceIntent): ImportantMention["type"] | null {
  switch (intent) {
    case "question":
      return "question";
    case "concern":
      return "problem";
    case "todo":
      return "todo";
    case "decision":
      return "decision";
    case "agreement":
    case "correction":
    case "switch_topic":
    case "unknown":
      return null;
  }
}
