import { extractJsonObject, requestChat, type ChatMessage, type LlmSettings } from "./llmClient";

export type TopicTitleCandidate = {
  topicId: string;
  currentTitle: string;
  evidenceQuotes: string[];
};

export type TopicTitleRefinement = {
  topicId: string;
  title: string;
};

const TITLE_REFINE_SYSTEM_PROMPT = [
  "あなたは会議ファシリテーションの補助AIです。",
  "会議の議題について、仮タイトルと発言の証拠から、内容を正確に表す簡潔な日本語タイトルを決めてください。",
  "発言の抜粋は議題の文脈を理解するための参考情報です。",
  "必ず次のJSONのみを出力してください:",
  '{"titles":[{"id":"...","title":"..."}]}',
  "ルール: 新しいタイトルは15字以内、日本語、シンプルで明確。idは与えられたものをそのまま使う。空のタイトルや不明瞭な修正は避ける。",
].join("\n");

export function buildTitleRefinePrompt(candidates: TopicTitleCandidate[]): string {
  const lines: string[] = [];
  for (const candidate of candidates) {
    lines.push(`## 議題ID: ${candidate.topicId}`);
    lines.push(`現在のタイトル: ${candidate.currentTitle}`);
    if (candidate.evidenceQuotes.length > 0) {
      lines.push("発言の証拠:");
      candidate.evidenceQuotes.forEach((quote) => {
        lines.push(`- ${quote}`);
      });
    } else {
      lines.push("(発言の証拠は記録されていません)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

type RawTitleResponse = {
  titles?: Array<{ id?: unknown; title?: unknown }>;
};

export function parseTitleRefineResponse(raw: string, validTopicIds: Set<string>): TopicTitleRefinement[] {
  const payload = extractJsonObject(raw) as RawTitleResponse;
  if (!Array.isArray(payload.titles)) {
    throw new Error("LLM応答にtitles配列がありません。");
  }

  const refinements: TopicTitleRefinement[] = [];
  for (const entry of payload.titles) {
    if (typeof entry.id !== "string" || !validTopicIds.has(entry.id)) continue;
    if (typeof entry.title !== "string" || entry.title.trim() === "") continue;
    refinements.push({
      topicId: entry.id,
      title: entry.title.trim(),
    });
  }

  if (refinements.length === 0) {
    throw new Error("LLM応答から有効なタイトル修正を作れませんでした。");
  }
  return refinements;
}

export async function refineTopicTitlesWithLlm(
  settings: LlmSettings,
  candidates: TopicTitleCandidate[],
  chat: (settings: LlmSettings, messages: ChatMessage[]) => Promise<string> = requestChat,
): Promise<TopicTitleRefinement[]> {
  if (candidates.length === 0) return [];
  const raw = await chat(settings, [
    { role: "system", content: TITLE_REFINE_SYSTEM_PROMPT },
    { role: "user", content: buildTitleRefinePrompt(candidates) },
  ]);
  return parseTitleRefineResponse(raw, new Set(candidates.map((c) => c.topicId)));
}
