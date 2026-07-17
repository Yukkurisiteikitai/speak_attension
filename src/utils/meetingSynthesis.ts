import type {
  AnalyzedSegment,
  MeetingGraph,
  MeetingSummary,
  MeetingSummaryCategory,
  MeetingSummaryItem,
  MeetingSummaryTopic,
} from "../types/topic";
import { isFillerUtterance, normalizeForMatch } from "./topicExtraction";

export const MEETING_SUMMARY_CATEGORY_LABELS: Record<MeetingSummaryCategory, string> = {
  issue: "課題",
  cause: "原因・背景",
  proposal: "案",
  concern: "懸念・反論",
  decision: "決定",
  action: "担当・期限",
  unresolved: "未解決",
};

export const MEETING_SUMMARY_CATEGORY_ORDER: MeetingSummaryCategory[] = [
  "issue",
  "cause",
  "proposal",
  "concern",
  "decision",
  "action",
  "unresolved",
];

const SHORT_PROGRESS_UTTERANCES = new Set(["どうぞ", "ふむ", "ええ", "はいどうぞ", "次どうぞ"]);

function isProgressUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "").replace(/[。.!！?？]/g, "");
  return isFillerUtterance(compact) || SHORT_PROGRESS_UTTERANCES.has(compact) || (compact.length <= 12 && /^ふむ/.test(compact));
}

function shortTitle(text: string, maxLength = 42): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function categoriesForSegment(segment: AnalyzedSegment): MeetingSummaryCategory[] {
  const text = segment.text;
  const keys = new Set(segment.analysis.coverageUpdates.map((update) => update.key));
  const categories = new Set<MeetingSummaryCategory>();

  if (segment.analysis.intent === "concern" || /問題|遅い|課題/.test(text)) categories.add("issue");
  if (keys.has("reason") || /理由|背景|ため|から/.test(text)) categories.add("cause");
  if (keys.has("alternative") || /別案|代替|導入|提案|どうでしょう/.test(text)) categories.add("proposal");
  if (keys.has("risk") || keys.has("objection") || /反論|懸念|不安|見落と|ないのでは|しまうのでは/.test(text)) categories.add("concern");
  if (segment.analysis.intent === "decision" || keys.has("decision") || /試してみよう|方針/.test(text)) categories.add("decision");
  if (segment.analysis.intent === "todo" || keys.has("owner") || keys.has("dueDate") || keys.has("nextAction") || /任せてください|準備して/.test(text)) categories.add("action");
  if (segment.analysis.intent === "question" && categories.size === 0) categories.add("unresolved");

  return categories.size ? [...categories] : ["proposal"];
}

function topicSeed(segment: AnalyzedSegment, fallbackTitle: string): string {
  const text = normalizeForMatch(segment.text);
  if (/\bai\b|aiを|人工知能/.test(text)) return "AI活用";
  return segment.analysis.selectedTopicLabel?.trim() || fallbackTitle;
}

function mergeTopicKey(seed: string, primaryTitle: string): string {
  const normalized = normalizeForMatch(seed);
  if (/\bai\b|ai活用|人工知能/.test(normalized)) return "AI活用";
  // The first agenda remains the meeting's main thread in the deterministic
  // fallback. A local LLM can later split it into finer-grained subtopics.
  return primaryTitle;
}

function appendItem(topic: MeetingSummaryTopic, category: MeetingSummaryCategory, segment: AnalyzedSegment): void {
  const title = shortTitle(segment.text);
  const duplicate = topic.items.find((item) => item.category === category && item.title === title);
  if (duplicate) {
    if (!duplicate.evidenceSegmentIds.includes(segment.id)) duplicate.evidenceSegmentIds.push(segment.id);
    return;
  }
  topic.items.push({
    id: `summary-item-${topic.id}-${category}-${topic.items.length + 1}`,
    category,
    title,
    evidenceSegmentIds: [segment.id],
  } satisfies MeetingSummaryItem);
}

export function buildRuleBasedMeetingSummary(input: {
  meetingGraph: MeetingGraph;
  segments: AnalyzedSegment[];
  now?: number;
}): MeetingSummary {
  const { meetingGraph } = input;
  const chronological = [...input.segments].sort((left, right) => left.createdAt - right.createdAt);
  const firstMeaningful = chronological.find((segment) => !isProgressUtterance(segment.text));
  const primaryTitle = firstMeaningful ? topicSeed(firstMeaningful, meetingGraph.title) : meetingGraph.title;
  const topicsByTitle = new Map<string, MeetingSummaryTopic>();
  const ignoredSegmentIds: string[] = [];

  for (const segment of chronological) {
    if (isProgressUtterance(segment.text)) {
      ignoredSegmentIds.push(segment.id);
      continue;
    }
    const topicTitle = mergeTopicKey(topicSeed(segment, primaryTitle), primaryTitle);
    const topic = topicsByTitle.get(topicTitle) ?? {
      id: `summary-topic-${topicsByTitle.size + 1}`,
      title: topicTitle,
      items: [],
    };
    categoriesForSegment(segment).forEach((category) => appendItem(topic, category, segment));
    topicsByTitle.set(topicTitle, topic);
  }

  return {
    meetingId: meetingGraph.meetingId,
    title: meetingGraph.title,
    generatedAt: input.now ?? Date.now(),
    source: "rules",
    topics: [...topicsByTitle.values()].filter((topic) => topic.items.length > 0),
    ignoredSegmentIds,
  };
}

export function renameMeetingSummaryNode(summary: MeetingSummary, nodeId: string, title: string): MeetingSummary {
  const nextTitle = title.trim();
  if (!nextTitle) return summary;
  return {
    ...summary,
    topics: summary.topics.map((topic) =>
      topic.id === nodeId
        ? { ...topic, title: nextTitle }
        : {
            ...topic,
            items: topic.items.map((item) => (item.id === nodeId ? { ...item, title: nextTitle } : item)),
          },
    ),
  };
}
