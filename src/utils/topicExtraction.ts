import type { ResolvedReference, TopicMatchCandidate, TopicNode, TopicPhraseCandidate } from "../types/topic";

const FILLER_PHRASES = new Set([
  "そうですね",
  "はい",
  "なるほど",
  "了解",
  "うん",
  "そうです",
  "ですね",
  "お願いします",
  "ありがとう",
]);
const PRONOUN_ONLY = /^(これ|それ|あれ|ここ|そこ|あそこ|この件|その件|あの件)$/;
const STOP_WORDS = new Set([
  "今日",
  "今回",
  "あと",
  "さっき",
  "話",
  "件",
  "ところ",
  "こと",
  "感じ",
  "ほう",
  "それ",
  "これ",
  "あれ",
  "そこ",
  "ここ",
  "みたい",
  "ですね",
  "です",
  "ます",
  "する",
  "したい",
  "した",
  "決める",
  "問題",
]);

const TOPIC_MARKER_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /(.{2,24}?)について/g, reason: "marker: について" },
  { regex: /(.{2,24}?)の件/g, reason: "marker: の件" },
  { regex: /(.{2,24}?)を決め(?:る|ます|たい)/g, reason: "marker: を決める" },
  { regex: /(.{2,24}?)が問題/g, reason: "marker: が問題" },
  { regex: /(.{2,24}?)した(?:い|くない|ほうがいい)/g, reason: "marker: したい" },
];

export function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase("ja-JP")
    .replace(/[「」『』（）()【】［］.,、。!?！？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitIntoClauses(text: string): string[] {
  return text
    .split(/[。.!！?？\n]/)
    .flatMap((chunk) => chunk.split(/(?:けど|ですが|ただ|それで|あとで|あと|なので|だから)/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokenize(text: string): string[] {
  const normalized = normalizeForMatch(text).replace(/(について|の件|って|で|が|は|を|に|と|も|から|まで|です|ます|する|したい|した|問題|理由)/g, " ");
  const matches = normalized.match(/[a-z0-9]+|[一-龠ぁ-んァ-ヶー]{2,}/g) ?? [];
  return matches.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function makeAliasPhrases(clause: string): string[] {
  const tokens = tokenize(clause);
  const aliases = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    aliases.add(tokens[index]);
    if (tokens[index + 1]) aliases.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return [...aliases].filter((alias) => alias.length >= 2).slice(0, 4);
}

function cleanupPhrase(value: string): string {
  return value
    .replace(/^(今日は|今回|では|その|この|あの|次に|まず|あとで|あと)\s*/g, "")
    .replace(/(について|の件|って|では|です|ます|の|が|を|は)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFillerUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact.length <= 8 && FILLER_PHRASES.has(compact);
}

export function extractTopicPhrases(text: string): TopicPhraseCandidate[] {
  if (isFillerUtterance(text)) return [];
  const phrases: TopicPhraseCandidate[] = [];

  for (const clause of splitIntoClauses(text)) {
    for (const pattern of TOPIC_MARKER_PATTERNS) {
      for (const match of clause.matchAll(pattern.regex)) {
        const phrase = cleanupPhrase(match[1] ?? "");
        if (!phrase || phrase.length < 2 || PRONOUN_ONLY.test(phrase) || isFillerUtterance(phrase)) continue;
        phrases.push({ phrase, clause, reason: pattern.reason });
      }
    }

    if (phrases.some((item) => item.clause === clause)) continue;

    const aliases = makeAliasPhrases(clause);
    const best = aliases.find((item) => !PRONOUN_ONLY.test(item));
    if (best && !isFillerUtterance(best)) {
      phrases.push({ phrase: cleanupPhrase(best), clause, reason: "fallback: content phrase" });
    }
  }

  return phrases.filter((item, index, all) => all.findIndex((candidate) => candidate.phrase === item.phrase) === index);
}

function overlapScore(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token));
  return overlap.length / Math.max(leftTokens.length, rightTokens.length);
}

export function scoreTopicMatch(phrase: string, node: TopicNode): TopicMatchCandidate {
  const aliases = [node.title, ...node.aliases];
  const scores = aliases.map((alias) => overlapScore(phrase, alias));
  const score = Math.max(...scores, 0);

  return {
    topicId: node.id,
    label: node.title,
    score: Number(score.toFixed(2)),
    reason: score > 0 ? `overlap with ${aliases[scores.indexOf(score)]}` : "no overlap",
  };
}

export function resolveTopicReference(text: string, activeTopicId: string | null): ResolvedReference[] {
  const phrases = ["その件", "この話", "さっきの話", "それで", "これ"];
  return phrases
    .filter((phrase) => text.includes(phrase))
    .map((phrase) => ({
      phrase,
      candidateTopicId: activeTopicId,
      confidence: activeTopicId ? 0.7 : 0.25,
      reason: activeTopicId ? "active topic reference" : "reference without active topic",
    }));
}
