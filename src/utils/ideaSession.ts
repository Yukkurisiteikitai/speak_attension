import { extractIdeaKeywords } from "./ideaExtraction";
import { normalizeForMatch } from "./topicExtraction";
import { createId } from "./topicProjection";

export type IdeaPhase = "capture" | "grouping" | "select";

export type IdeaUtteranceSource = "speech" | "manual";

export type IdeaUtterance = {
  id: string;
  text: string;
  source: IdeaUtteranceSource;
  at: number;
};

export type IdeaKeyword = {
  id: string;
  label: string;
  normalized: string;
  mentionCount: number;
  utteranceIds: string[];
  firstMentionedAt: number;
  groupId: string | null;
  picked: boolean;
};

export type IdeaGroup = {
  id: string;
  title: string;
  keywordIds: string[];
};

export type IdeaGroupingSource = "llm" | "rules";

export type IdeaSessionState = {
  phase: IdeaPhase;
  startedAt: number;
  title: string;
  utterances: IdeaUtterance[];
  keywords: IdeaKeyword[];
  groups: IdeaGroup[];
  groupingSource: IdeaGroupingSource | null;
};

export function createInitialIdeaSessionState(now: number = Date.now()): IdeaSessionState {
  return {
    phase: "capture",
    startedAt: now,
    title: "アイデア出しセッション",
    utterances: [],
    keywords: [],
    groups: [],
    groupingSource: null,
  };
}

// Capture-phase reducer: records the utterance and merges extracted keywords
// into existing ones by normalized label so repeated mentions grow one node
// instead of spawning duplicates.
export function addIdeaUtterance(
  state: IdeaSessionState,
  text: string,
  source: IdeaUtteranceSource,
  now: number = Date.now(),
): IdeaSessionState {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText || state.phase !== "capture") return state;

  const utterance: IdeaUtterance = {
    id: createId("utt"),
    text: cleanText,
    source,
    at: now,
  };

  const keywords = [...state.keywords];
  for (const candidate of extractIdeaKeywords(cleanText)) {
    const normalized = normalizeForMatch(candidate.label);
    const existingIndex = keywords.findIndex((keyword) => keyword.normalized === normalized);
    if (existingIndex >= 0) {
      const existing = keywords[existingIndex];
      keywords[existingIndex] = {
        ...existing,
        mentionCount: existing.mentionCount + 1,
        utteranceIds: existing.utteranceIds.includes(utterance.id)
          ? existing.utteranceIds
          : [...existing.utteranceIds, utterance.id],
      };
      continue;
    }
    keywords.push({
      id: createId("idea"),
      label: candidate.label,
      normalized,
      mentionCount: 1,
      utteranceIds: [utterance.id],
      firstMentionedAt: now,
      groupId: null,
      picked: false,
    });
  }

  return {
    ...state,
    utterances: [...state.utterances, utterance],
    keywords,
  };
}

export function beginGrouping(state: IdeaSessionState): IdeaSessionState {
  if (state.phase !== "capture" || state.keywords.length === 0) return state;
  return { ...state, phase: "grouping" };
}

// Applies computed groups and moves to the pick phase. Keywords the grouping
// missed are collected into an automatic その他 group so nothing disappears.
export function applyGrouping(
  state: IdeaSessionState,
  groups: IdeaGroup[],
  source: IdeaGroupingSource,
): IdeaSessionState {
  const knownKeywordIds = new Set(state.keywords.map((keyword) => keyword.id));
  const assigned = new Set<string>();
  const cleanGroups: IdeaGroup[] = [];

  for (const group of groups) {
    const keywordIds = group.keywordIds.filter((id) => knownKeywordIds.has(id) && !assigned.has(id));
    if (keywordIds.length === 0) continue;
    keywordIds.forEach((id) => assigned.add(id));
    cleanGroups.push({ ...group, keywordIds });
  }

  const leftovers = state.keywords.filter((keyword) => !assigned.has(keyword.id)).map((keyword) => keyword.id);
  if (leftovers.length > 0) {
    cleanGroups.push({ id: createId("group"), title: "その他", keywordIds: leftovers });
  }

  const groupIdByKeyword = new Map<string, string>();
  for (const group of cleanGroups) {
    for (const keywordId of group.keywordIds) groupIdByKeyword.set(keywordId, group.id);
  }

  return {
    ...state,
    phase: "select",
    groups: cleanGroups,
    groupingSource: source,
    keywords: state.keywords.map((keyword) => ({
      ...keyword,
      groupId: groupIdByKeyword.get(keyword.id) ?? null,
    })),
  };
}

// まだ出し切っていなかったとき用: グループを捨てて発散フェーズへ戻る。
export function resumeCapture(state: IdeaSessionState): IdeaSessionState {
  if (state.phase === "capture") return state;
  return {
    ...state,
    phase: "capture",
    groups: [],
    groupingSource: null,
    keywords: state.keywords.map((keyword) => ({ ...keyword, groupId: null })),
  };
}

export function toggleKeywordPick(state: IdeaSessionState, keywordId: string): IdeaSessionState {
  if (state.phase !== "select") return state;
  return {
    ...state,
    keywords: state.keywords.map((keyword) =>
      keyword.id === keywordId ? { ...keyword, picked: !keyword.picked } : keyword,
    ),
  };
}

function formatTimestamp(at: number): string {
  return new Date(at).toLocaleString("ja-JP");
}

function keywordSourceLines(keyword: IdeaKeyword, utterancesById: Map<string, IdeaUtterance>): string[] {
  return keyword.utteranceIds
    .map((id) => utterancesById.get(id))
    .filter((utterance): utterance is IdeaUtterance => Boolean(utterance))
    .slice(0, 3)
    .map((utterance) => `    - 出典: 「${utterance.text}」`);
}

export function renderIdeaMarkdown(state: IdeaSessionState, generatedAt: number = Date.now()): string {
  const utterancesById = new Map(state.utterances.map((utterance) => [utterance.id, utterance]));
  const keywordsById = new Map(state.keywords.map((keyword) => [keyword.id, keyword]));
  const lines: string[] = [
    `# ${state.title} 結果`,
    "",
    `- 生成日時: ${formatTimestamp(generatedAt)}`,
    `- 発言数: ${state.utterances.length}`,
    `- キーワード数: ${state.keywords.length}`,
    `- 採用: ${state.keywords.filter((keyword) => keyword.picked).length}`,
    `- グルーピング: ${state.groupingSource === "llm" ? "ローカルLLM" : state.groupingSource === "rules" ? "ルールベース" : "未実施"}`,
    "",
    "## 採用アイデア",
  ];

  let pickedTotal = 0;
  for (const group of state.groups) {
    const picked = group.keywordIds
      .map((id) => keywordsById.get(id))
      .filter((keyword): keyword is IdeaKeyword => Boolean(keyword?.picked));
    if (picked.length === 0) continue;
    pickedTotal += picked.length;
    lines.push("", `### ${group.title}`);
    for (const keyword of picked) {
      lines.push(`- ${keyword.label}(言及${keyword.mentionCount}回)`);
      lines.push(...keywordSourceLines(keyword, utterancesById));
    }
  }
  if (pickedTotal === 0) lines.push("", "(採用されたキーワードはありません)");

  lines.push("", "## 未採用キーワード");
  const unpicked = state.keywords.filter((keyword) => !keyword.picked);
  if (unpicked.length === 0) {
    lines.push("", "(なし)");
  } else {
    lines.push("", unpicked.map((keyword) => keyword.label).join(" / "));
  }

  lines.push("", "## 会話ログ", "");
  for (const utterance of state.utterances) {
    lines.push(`- [${formatTimestamp(utterance.at)}] ${utterance.text}`);
  }

  return `${lines.join("\n")}\n`;
}

export type IdeaSessionExport = {
  version: 1;
  kind: "idea_session";
  generatedAt: number;
  startedAt: number;
  title: string;
  utterances: IdeaUtterance[];
  keywords: IdeaKeyword[];
  groups: IdeaGroup[];
  groupingSource: IdeaGroupingSource | null;
};

// JSON export that keeps keyword→utterance links intact so the session can be
// re-ingested later as retrieval context (RAG) for a follow-up session.
export function buildIdeaSessionExport(state: IdeaSessionState, generatedAt: number = Date.now()): IdeaSessionExport {
  return {
    version: 1,
    kind: "idea_session",
    generatedAt,
    startedAt: state.startedAt,
    title: state.title,
    utterances: state.utterances,
    keywords: state.keywords,
    groups: state.groups,
    groupingSource: state.groupingSource,
  };
}
