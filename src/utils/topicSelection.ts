import type { MeetingGraph, TopicNode, TopicPhraseCandidate } from "../types/topic";
import { createEmptyCoverage } from "./topicCoverage";
import { createId, getRootTopicId } from "./topicProjection";
import { extractTopicPhrases, normalizeForMatch, scoreTopicMatch } from "./topicExtraction";

const TOPIC_MATCH_THRESHOLD = 0.5;

export function appendEvidenceSegmentIds(current: string[], segmentId: string): string[] {
  return [segmentId, ...current.filter((id) => id !== segmentId)].slice(0, 8);
}

export function mergeAliases(current: string[], phrases: TopicPhraseCandidate[]): string[] {
  const next = new Set(current);
  phrases.forEach((phrase) => next.add(normalizeForMatch(phrase.phrase)));
  return [...next].filter(Boolean).slice(0, 8);
}

export function mergeAliasStrings(current: string[], titles: string[]): string[] {
  const next = new Set(current);
  titles.forEach((title) => next.add(normalizeForMatch(title)));
  return [...next].filter(Boolean).slice(0, 8);
}

export function createTopicFromPhrase(phrase: TopicPhraseCandidate, segmentId: string, now: number, segmentIndex: number): TopicNode {
  return {
    id: createId("topic"),
    title: phrase.phrase,
    aliases: [normalizeForMatch(phrase.phrase), ...extractTopicPhrases(phrase.clause).map((item) => normalizeForMatch(item.phrase))].slice(0, 6),
    lifecycle: "active",
    displayStates: ["active"],
    coverage: createEmptyCoverage(),
    evidenceSegmentIds: [segmentId],
    mentionCount: 1,
    openQuestionCount: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    lastActivatedAt: now,
    closedAt: null,
    lastActivatedSegmentIndex: segmentIndex,
  };
}

export function chooseSelectedTopic(input: {
  graph: MeetingGraph;
  phrases: TopicPhraseCandidate[];
  currentTopicId: string | null;
}): {
  selectedTopicId: string | null;
  selectedScores: ReturnType<typeof scoreTopicMatch>[];
  shouldCreateTopic: boolean;
  selectedPhrase: TopicPhraseCandidate | null;
} {
  const topicNodes = input.graph.nodes.filter((node) => node.id !== getRootTopicId());
  const scored = input.phrases.flatMap((phrase) =>
    topicNodes.map((node) => ({
      ...scoreTopicMatch(phrase.phrase, node),
      phrase,
    })),
  );
  const selected = [...scored].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "ja-JP"))[0] ?? null;
  if (selected && selected.score >= TOPIC_MATCH_THRESHOLD) {
    return {
      selectedTopicId: selected.topicId,
      selectedScores: scored
        .filter((item) => item.phrase.phrase === selected.phrase.phrase)
        .map(({ phrase: _phrase, ...rest }) => rest)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5),
      shouldCreateTopic: false,
      selectedPhrase: selected.phrase,
    };
  }

  return {
    selectedTopicId: null,
    selectedScores: input.phrases[0]
      ? topicNodes
          .map((node) => scoreTopicMatch(input.phrases[0].phrase, node))
          .sort((left, right) => right.score - left.score)
          .slice(0, 5)
      : [],
    shouldCreateTopic: Boolean(input.phrases[0]),
    selectedPhrase: input.phrases[0] ?? null,
  };
}
