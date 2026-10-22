import type { AnalyzedSegment, MeetingDecisionGraph, MissingContribution, TopicGap, TopicGapSeverity, TopicNode } from "../types/topic";
import { selectCurrentActions, selectUnresolvedQuestions } from "./meetingDecisionGraph";
import { buildTopicGaps } from "./topicCoverage";

type BuildMissingContributionsInput = {
  gaps: TopicGap[];
  topics: TopicNode[];
  decisionGraph: MeetingDecisionGraph;
  segments: AnalyzedSegment[];
  currentTopicId: string | null;
};

const severityWeight: Record<TopicGapSeverity, number> = { high: 3, medium: 2, low: 1 };
const unique = (ids: string[]) => [...new Set(ids)];

function relatedAction(graph: MeetingDecisionGraph, topic: TopicNode) {
  return selectCurrentActions(graph).find((action) => action.state === "decided" && action.provenance.utteranceIds.some((id) => topic.evidenceSegmentIds.includes(id))) ?? null;
}

function guidance(gap: TopicGap, topic: TopicNode, actionLabel: string | null): Pick<MissingContribution, "question" | "exampleUtterance"> {
  const action = actionLabel ?? "このアクション";
  switch (gap.type) {
    case "missing_decision": return { question: topic.title + "はどの案で進めるか、または何を確認してから決めるかを決めましょう。", exampleUtterance: "比較する案と判断に必要な事実を確認してから決めます。" };
    case "missing_reason": return { question: topic.title + "をその方針にする根拠は何ですか？", exampleUtterance: "この方針にする理由は、確認済みの事実がこれだからです。" };
    case "missing_owner": return { question: action + "は誰が担当しますか？", exampleUtterance: "この対応は田中さんが担当します。" };
    case "missing_due_date": return { question: action + "はいつまでに完了または進捗確認しますか？", exampleUtterance: "進捗は金曜日までに確認します。" };
    case "missing_next_action": return { question: topic.title + "について、次に誰が何をしますか？", exampleUtterance: "次に担当者が確認し、結果を共有します。" };
    case "missing_risk": return { question: topic.title + "を進める場合のリスクと、止める条件は何ですか？", exampleUtterance: "このリスクが出たら止めて、再確認します。" };
    case "missing_alternative": return { question: topic.title + "には比較すべき別案や反対意見がありますか？", exampleUtterance: "別案としてこちらも比較しましょう。" };
    case "unresolved": return { question: topic.title + "で残っている疑問に答えるため、確認できている事実は何ですか？", exampleUtterance: "確認済みの事実はこれです。" };
    case "shallow": return { question: topic.title + "について、判断に必要な事実は何ですか？", exampleUtterance: "現時点で確認できている事実を整理します。" };
  }
}

export function buildMissingContributions(input: BuildMissingContributionsInput): MissingContribution[] {
  const topics = new Map(input.topics.map((topic) => [topic.id, topic]));
  const contributions: Array<MissingContribution & { createdAt: number }> = [];
  // Active topics do not persist gaps yet: derive them here as well, so the
  // facilitator gets guidance while the discussion is still in progress.
  const gapsByTopic = new Map(input.topics.map((topic) => [topic.id, input.gaps.filter((gap) => gap.topicId === topic.id && !gap.closedAt)]));
  const derivedGaps = input.topics.flatMap((topic) => {
    const existing = gapsByTopic.get(topic.id) ?? [];
    return existing.length > 0 ? existing : buildTopicGaps(
      topic,
      topic.openQuestionCount > 0 && !topic.coverage.openQuestionResolved,
      topic.lastSeenAt,
    );
  });

  for (const gap of derivedGaps) {
    const topic = topics.get(gap.topicId);
    if (!topic) continue;
    const action = relatedAction(input.decisionGraph, topic);
    // Structured actions own these fields; topic-wide coverage cannot say
    // whether every individual action has an owner, deadline or reason.
    if (action && ["missing_owner", "missing_due_date", "missing_reason"].includes(gap.type)) continue;
    const content = guidance(gap, topic, action?.action?.what ?? action?.label ?? null);
    contributions.push({ id: "contribution-" + gap.id, topicId: topic.id, relatedActionId: action?.id ?? null, kind: gap.type, priority: gap.severity, ...content, rationale: gap.detail, evidenceSegmentIds: unique([...topic.evidenceSegmentIds, ...(action?.provenance.utteranceIds ?? [])]), createdAt: gap.createdAt });
  }
  for (const action of selectCurrentActions(input.decisionGraph).filter((node) => node.state === "decided")) {
    const topic = input.topics.find((candidate) => action.provenance.utteranceIds.some((id) => candidate.evidenceSegmentIds.includes(id)));
    const fields = [
      ["missing_owner", action.action?.owner, "high", "誰が担当しますか？", "担当がこのアクションに記録されていません。"],
      ["missing_due_date", action.action?.deadline, "medium", "いつまでに完了または進捗確認しますか？", "期限がこのアクションに記録されていません。"],
      ["missing_reason", action.action?.why, "medium", "実施する根拠は何ですか？", "実施理由がこのアクションに記録されていません。"],
    ] as const;
    for (const [kind, value, priority, question, rationale] of fields) {
      if (value?.trim()) continue;
      contributions.push({
        id: `contribution-${action.id}-${kind}`,
        topicId: topic?.id ?? "",
        relatedActionId: action.id,
        kind,
        priority,
        question: `${action.action?.what ?? action.label}は${question}`,
        exampleUtterance: kind === "missing_owner" ? "この対応は田中さんが担当します。" : kind === "missing_due_date" ? "進捗は金曜日までに確認します。" : "この対応の理由と確認できた事実を説明します。",
        rationale,
        evidenceSegmentIds: unique(action.provenance.utteranceIds),
        createdAt: action.createdAt,
      });
    }
  }
  for (const question of selectUnresolvedQuestions(input.decisionGraph)) {
    const topic = input.topics.find((candidate) => question.provenance.utteranceIds.some((id) => candidate.evidenceSegmentIds.includes(id))) ?? (input.currentTopicId ? topics.get(input.currentTopicId) : undefined);
    if (!topic) continue;
    contributions.push({ id: "contribution-" + question.id, topicId: topic.id, relatedActionId: null, kind: "unresolved_question", priority: "high", question: question.label + " に答えるため、確認できている事実は何ですか？", exampleUtterance: "確認できている事実はこれです。", rationale: "明示的な回答がまだ質問に接続されていません。", evidenceSegmentIds: unique([...topic.evidenceSegmentIds, ...question.provenance.utteranceIds]), createdAt: question.createdAt });
  }
  return contributions.sort((left, right) => Number(right.topicId === input.currentTopicId) - Number(left.topicId === input.currentTopicId) || severityWeight[right.priority] - severityWeight[left.priority] || Number(Boolean(right.relatedActionId)) - Number(Boolean(left.relatedActionId)) || left.createdAt - right.createdAt || left.question.localeCompare(right.question, "ja-JP")).map(({ createdAt: _createdAt, ...contribution }) => contribution);
}
