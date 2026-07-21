import type { AnalyzedSegment, MeetingSummary, MeetingSummaryCategory, MeetingSummaryItem, MeetingSummaryTopic } from "../types/topic";
import { MEETING_SUMMARY_CATEGORIES } from "../types/topic";
import { extractJsonObject, requestChat, type ChatMessage, type LlmSettings } from "./llmClient";

const CATEGORIES = new Set<string>(MEETING_SUMMARY_CATEGORIES);
const MEETING_SUMMARY_MAX_TOKENS = 1200;

const SYSTEM_PROMPT = [
  "あなたは会議ファシリテーションの補助AIです。",
  "会議の発言を、根拠を失わない終了時のマインドマップへ整理してください。",
  "思考過程・解説・Markdownは一切出力せず、最初の文字からJSONを出力してください。",
  "議題を統合し、各要点を次の分類へ入れてください: issue, cause, proposal, concern, decision, action, unresolved。",
  "相槌や進行だけの発言は要点にしません。推測や発言にない事実を追加してはいけません。",
  "各要点には、根拠となる発言IDを1件以上、必ず指定してください。",
  'JSONのみを返してください: {"topics":[{"title":"...","items":[{"category":"issue","title":"...","sourceSegmentIds":["seg..."]}]}]}',
].join("\n");

export function buildMeetingSynthesisPrompt(segments: AnalyzedSegment[], fallback: MeetingSummary): string {
  const lines = ["## 規則ベースの暫定整理"];
  fallback.topics.forEach((topic) => {
    lines.push(`- 議題: ${topic.title}`);
    topic.items.forEach((item) => lines.push(`  - ${item.category}: ${item.title} (${item.evidenceSegmentIds.join(", ")})`));
  });
  lines.push("", "## 会議の発言");
  [...segments]
    .sort((left, right) => left.createdAt - right.createdAt)
    .forEach((segment) => lines.push(`- id: ${segment.id}\n  発言: ${segment.text}`));
  return lines.join("\n");
}

type RawMeetingSummary = {
  topics?: Array<{
    title?: unknown;
    items?: Array<{ category?: unknown; title?: unknown; sourceSegmentIds?: unknown }>;
  }>;
};

function isCategory(value: unknown): value is MeetingSummaryCategory {
  return typeof value === "string" && CATEGORIES.has(value);
}

export function parseMeetingSynthesisResponse(raw: string, fallback: MeetingSummary, validSegmentIds: Set<string>): MeetingSummary {
  const payload = extractJsonObject(raw) as RawMeetingSummary;
  if (!Array.isArray(payload.topics)) throw new Error("LLM応答にtopics配列がありません。");

  const topics: MeetingSummaryTopic[] = [];
  payload.topics.forEach((rawTopic, topicIndex) => {
    if (typeof rawTopic.title !== "string" || !rawTopic.title.trim() || !Array.isArray(rawTopic.items)) return;
    const items: MeetingSummaryItem[] = [];
    rawTopic.items.forEach((rawItem, itemIndex) => {
      if (!isCategory(rawItem.category) || typeof rawItem.title !== "string" || !rawItem.title.trim() || !Array.isArray(rawItem.sourceSegmentIds)) return;
      const evidenceSegmentIds = [...new Set(rawItem.sourceSegmentIds.filter((id): id is string => typeof id === "string" && validSegmentIds.has(id)))];
      if (evidenceSegmentIds.length === 0) return;
      items.push({
        id: `summary-item-llm-${topicIndex + 1}-${itemIndex + 1}`,
        category: rawItem.category,
        title: rawItem.title.trim().slice(0, 80),
        evidenceSegmentIds,
      });
    });
    if (items.length) {
      topics.push({
        id: `summary-topic-llm-${topicIndex + 1}`,
        title: rawTopic.title.trim().slice(0, 50),
        items,
      });
    }
  });

  if (topics.length === 0) throw new Error("LLM応答から根拠付きの整理結果を作れませんでした。");
  const selectedIds = new Set(topics.flatMap((topic) => topic.items.flatMap((item) => item.evidenceSegmentIds)));
  return {
    ...fallback,
    source: "llm",
    topics,
    ignoredSegmentIds: fallback.ignoredSegmentIds.filter((id) => !selectedIds.has(id)),
  };
}

export async function refineMeetingSummaryWithLlm(
  segments: AnalyzedSegment[],
  fallback: MeetingSummary,
  settings: LlmSettings,
  chat: (settings: LlmSettings, messages: ChatMessage[], options?: { maxTokens?: number }) => Promise<string> = requestChat,
): Promise<MeetingSummary> {
  const raw = await chat(settings, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildMeetingSynthesisPrompt(segments, fallback) },
  ], { maxTokens: MEETING_SUMMARY_MAX_TOKENS });
  return parseMeetingSynthesisResponse(raw, fallback, new Set(segments.map((segment) => segment.id)));
}
