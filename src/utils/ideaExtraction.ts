import { isFillerUtterance, normalizeForMatch, splitIntoClauses } from "./topicExtraction";

// Brainstorm-specific stop words: generic conversation scaffolding that never
// works as an idea keyword even though it survives particle stripping.
const IDEA_STOP_WORDS = new Set([
  "今日",
  "今回",
  "あと",
  "さっき",
  "みんな",
  "自分",
  "あれ",
  "これ",
  "それ",
  "ここ",
  "そこ",
  "こと",
  "もの",
  "ところ",
  "感じ",
  "とき",
  "ほう",
  "やつ",
  "アイデア",
  "アイディア",
  "キーワード",
  "意見",
  "話",
  "件",
  "案",
  "たとえば",
  "例えば",
  "そういう",
  "こういう",
  "ちょっと",
  "けっこう",
  "結構",
  "やっぱり",
  "たしかに",
  "確かに",
  "いいね",
  "いい",
  "よさそう",
  "ある",
  "ない",
  "なる",
  "やる",
  "思う",
  "思います",
  "考える",
  "出す",
  "できる",
  "できそう",
  "ほしい",
  "欲しい",
  "みたい",
  "とか",
  "です",
  "ます",
  "する",
  "したい",
  "した",
]);

const FUNCTION_WORD_PATTERN = /(について|の件|っていう|という|といった|って|とか|など|なんか|みたいな|ですね|でしょう|です|ます)/g;

function isHiraganaOnly(token: string): boolean {
  return /^[ぁ-ん]+$/.test(token);
}

// Keywords are anchored on kanji/katakana/latin runs: hiragana works as a
// natural separator, which keeps compounds like プッシュ通知 intact while
// dropping inflections (〜かな, 〜したい) without morphological analysis.
// Hiragana-only words are only kept when long enough to be a concept.
export function tokenizeIdeaClause(clause: string): string[] {
  const normalized = normalizeForMatch(clause).replace(FUNCTION_WORD_PATTERN, " ");
  const matches = normalized.match(/[a-z0-9][a-z0-9+\-_.]*|[一-龠ァ-ヶー]{2,}|[ぁ-ん]{4,}/g) ?? [];

  return matches.filter((token) => {
    if (token.length < 2) return false;
    if (IDEA_STOP_WORDS.has(token)) return false;
    if (isHiraganaOnly(token) && /^[っんー]/.test(token)) return false;
    return true;
  });
}

export type IdeaKeywordCandidate = {
  label: string;
  clause: string;
};

// Pulls candidate idea keywords out of one utterance. Brainstorming favors
// recall over precision here: noisy keywords can be dropped at pick time,
// but a missed keyword never reaches the map.
export function extractIdeaKeywords(text: string): IdeaKeywordCandidate[] {
  if (isFillerUtterance(text)) return [];

  const seen = new Set<string>();
  const candidates: IdeaKeywordCandidate[] = [];

  for (const clause of splitIntoClauses(text)) {
    for (const token of tokenizeIdeaClause(clause)) {
      const key = normalizeForMatch(token);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ label: token, clause });
    }
  }

  return candidates.slice(0, 8);
}
