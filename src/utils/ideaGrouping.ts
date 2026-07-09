import { tokenizeIdeaClause } from "./ideaExtraction";
import type { IdeaGroup, IdeaKeyword, IdeaUtterance } from "./ideaSession";
import { extractJsonObject, requestChat, type LlmSettings } from "./llmClient";
import { normalizeForMatch } from "./topicExtraction";
import { createId } from "./topicProjection";

function tokensOf(keyword: IdeaKeyword): Set<string> {
  const tokens = new Set([keyword.normalized, ...tokenizeIdeaClause(keyword.label)]);
  // Also index script-level sub-runs so プッシュ通知 and 通知バッジ meet on 通知.
  for (const token of [...tokens]) {
    for (const segment of token.match(/[ァ-ヶー]{2,}|[一-龠]{2,}|[a-z0-9]{2,}/g) ?? []) {
      tokens.add(segment);
    }
  }
  return tokens;
}

function shareToken(left: Set<string>, right: Set<string>): boolean {
  for (const token of left) {
    for (const other of right) {
      if (token === other) return true;
      // Substring containment catches compounds like 通知 / プッシュ通知.
      if (token.length >= 2 && other.length >= 2 && (token.includes(other) || other.includes(token))) return true;
    }
  }
  return false;
}

function shareUtterance(left: IdeaKeyword, right: IdeaKeyword): boolean {
  const rightIds = new Set(right.utteranceIds);
  return left.utteranceIds.some((id) => rightIds.has(id));
}

// Deterministic fallback grouping: greedy clustering on lexical overlap first,
// then co-occurrence in the same utterance. Singleton clusters are merged into
// a trailing その他 group by applyGrouping.
export function groupIdeasByRules(keywords: IdeaKeyword[]): IdeaGroup[] {
  const remaining = [...keywords].sort((left, right) => right.mentionCount - left.mentionCount);
  const tokenCache = new Map(remaining.map((keyword) => [keyword.id, tokensOf(keyword)]));
  const groups: IdeaGroup[] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift();
    if (!seed) break;
    const members = [seed];

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index];
      const matchesMember = members.some((member) => {
        const memberTokens = tokenCache.get(member.id);
        const candidateTokens = tokenCache.get(candidate.id);
        if (memberTokens && candidateTokens && shareToken(memberTokens, candidateTokens)) return true;
        return shareUtterance(member, candidate);
      });
      if (matchesMember) {
        members.push(candidate);
        remaining.splice(index, 1);
      }
    }

    if (members.length < 2) continue;
    groups.push({
      id: createId("group"),
      title: `${seed.label} 系`,
      keywordIds: members.map((member) => member.id),
    });
  }

  return groups;
}

const GROUPING_SYSTEM_PROMPT = [
  "あなたはブレインストーミングのファシリテーターです。",
  "会話から抽出されたキーワード一覧を、意味の近さでグループ分けしてください。",
  "会話の抜粋はキーワードの文脈を理解するための参考情報です。",
  "必ず次のJSONだけを出力してください:",
  '{"groups":[{"title":"グループ名","keywords":["キーワード1","キーワード2"]}]}',
  "ルール: グループ名は短い日本語。各キーワードはちょうど1つのグループに入れる。新しいキーワードを発明しない。",
].join("\n");

export function buildGroupingPrompt(keywords: IdeaKeyword[], utterances: IdeaUtterance[]): string {
  const keywordLines = keywords.map((keyword) => `- ${keyword.label}(言及${keyword.mentionCount}回)`);
  const excerptLines = utterances.slice(-40).map((utterance) => `- ${utterance.text}`);
  return [
    "## キーワード一覧",
    ...keywordLines,
    "",
    "## 会話の抜粋",
    ...excerptLines,
  ].join("\n");
}

type RawGroupingResponse = {
  groups?: Array<{ title?: unknown; keywords?: unknown }>;
};

export function parseGroupingResponse(raw: string, keywords: IdeaKeyword[]): IdeaGroup[] {
  const payload = extractJsonObject(raw) as RawGroupingResponse;
  if (!Array.isArray(payload.groups)) {
    throw new Error("LLM応答にgroups配列がありません。");
  }

  const keywordByNormalized = new Map(keywords.map((keyword) => [keyword.normalized, keyword]));
  const assigned = new Set<string>();
  const groups: IdeaGroup[] = [];

  for (const rawGroup of payload.groups) {
    const title = typeof rawGroup.title === "string" ? rawGroup.title.trim() : "";
    const rawKeywords = Array.isArray(rawGroup.keywords) ? rawGroup.keywords : [];
    const keywordIds: string[] = [];

    for (const rawKeyword of rawKeywords) {
      if (typeof rawKeyword !== "string") continue;
      const match = keywordByNormalized.get(normalizeForMatch(rawKeyword));
      if (!match || assigned.has(match.id)) continue;
      assigned.add(match.id);
      keywordIds.push(match.id);
    }

    if (keywordIds.length === 0) continue;
    groups.push({
      id: createId("group"),
      title: title || "無題グループ",
      keywordIds,
    });
  }

  if (groups.length === 0) {
    throw new Error("LLM応答から有効なグループを作れませんでした。");
  }
  return groups;
}

export async function groupIdeasWithLlm(
  settings: LlmSettings,
  keywords: IdeaKeyword[],
  utterances: IdeaUtterance[],
): Promise<IdeaGroup[]> {
  const raw = await requestChat(settings, [
    { role: "system", content: GROUPING_SYSTEM_PROMPT },
    { role: "user", content: buildGroupingPrompt(keywords, utterances) },
  ]);
  return parseGroupingResponse(raw, keywords);
}
