import type { AnalyzedSegment, MeetingDecisionGraph, MeetingDecisionNode, TopicNode } from "../types/topic";
import { selectUnresolvedQuestions } from "./meetingDecisionGraph";

// "現在地": what the meeting is doing right now, distinct from the parts list
// (confirmed decisions / gaps / etc.). This is a derived UI concept — it never
// creates a new confirmed fact, and it must stay honest about what is a
// mechanical classification (the stage) vs. a template sentence built from
// that classification (the progress condition). Both are always presented as
// rule-derived, never as an AI judgement of importance.

export type TopicTitleSource = "extracted_topic" | "unresolved_question" | "recent_utterance" | "unknown";

export type DiscussionStageId =
  | "confirming_problem" // 問題を確認中
  | "organizing_reasons" // 原因・理由を整理中
  | "generating_options" // 選択肢を出している
  | "comparing_options" // 選択肢を比較中
  | "resolving_question" // 未解決の問いを確認中
  | "decided" // 決定済み
  | "clarifying_execution" // 実行内容を具体化中
  | "in_progress" // 実行中
  | "ambiguous" // 複数の検討が進行中
  | "unknown"; // 状態を特定できません

export const discussionStageLabels: Record<DiscussionStageId, string> = {
  confirming_problem: "問題を確認中",
  organizing_reasons: "原因・理由を整理中",
  generating_options: "選択肢を出している",
  comparing_options: "選択肢を比較中",
  resolving_question: "未解決の問いを確認中",
  decided: "決定済み",
  clarifying_execution: "実行内容を具体化中",
  in_progress: "実行中",
  ambiguous: "複数の検討が進行中",
  unknown: "状態を特定できません",
};

export type CurrentDiscussionState = {
  topicTitle: string | null;
  topicTitleSource: TopicTitleSource;
  stage: DiscussionStageId;
  unresolvedQuestion: MeetingDecisionNode | null;
  progressCondition: string | null;
  // Not every discussion is "deciding" something (e.g. still exploring what a
  // condition even means). Only set once a decision actually exists in scope
  // -- never invented just because a topic exists.
  decisionThemeTitle: string | null;
  counts: { confirmedDecisions: number; structuralGaps: number; unresolvedItems: number; nextActions: number };
};

const MAX_TITLE_LENGTH = 40;

function truncate(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

// A topic title must never start with a bare case particle (a sign that
// phrase extraction dropped its subject) and must carry some actual content.
export function isWellFormedTopicTitle(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 2) return false;
  if (/^[のをがはにでともへ]/.test(trimmed)) return false;
  return true;
}

function isActionMissingOwnerOrDeadline(node: MeetingDecisionNode): boolean {
  return Boolean(node.action) && (!node.action!.owner || !node.action!.deadline);
}

export function buildCurrentDiscussionState(
  meetingGraph: { nodes: TopicNode[] } | null,
  currentTopicId: string | null,
  decisionGraph: MeetingDecisionGraph,
  segments: AnalyzedSegment[],
): CurrentDiscussionState {
  const currentTopicNode = currentTopicId ? meetingGraph?.nodes.find((node) => node.id === currentTopicId) ?? null : null;

  // Scope: everything created since this topic last became active. This is a
  // simple, explainable approximation (not a proven causal link to the
  // topic) — when there is no current topic, fall back to the whole graph.
  const sinceTs = currentTopicNode?.lastActivatedAt ?? 0;
  const scopedNodes = decisionGraph.nodes.filter((node) => node.createdAt >= sinceTs);

  const unresolvedQuestionIds = new Set(selectUnresolvedQuestions(decisionGraph).map((node) => node.id));
  const unresolvedQuestions = scopedNodes.filter((node) => node.type === "question" && unresolvedQuestionIds.has(node.id));
  const problems = scopedNodes.filter((node) => node.type === "problem");
  const reasons = scopedNodes.filter((node) => node.type === "reason");
  const proposals = scopedNodes.filter((node) => node.type === "proposal");
  const decisions = scopedNodes.filter((node) => node.type === "decision");
  const actions = scopedNodes.filter((node) => node.type === "action");

  const unresolvedQuestion = unresolvedQuestions[0] ?? null;

  let stage: DiscussionStageId;
  let progressCondition: string | null;

  if (unresolvedQuestion) {
    stage = "resolving_question";
    progressCondition = `「${unresolvedQuestion.label}」に回答が記録されること`;
  } else if (actions.length > 0) {
    if (actions.some((node) => node.action?.status === "in_progress")) {
      stage = "in_progress";
      progressCondition = "実行結果が記録されること";
    } else if (actions.some(isActionMissingOwnerOrDeadline)) {
      stage = "clarifying_execution";
      const gapAction = actions.find(isActionMissingOwnerOrDeadline)!;
      const missing = [!gapAction.action!.owner ? "担当" : null, !gapAction.action!.deadline ? "期限" : null].filter(Boolean).join("・");
      progressCondition = `${missing}が記録されること`;
    } else {
      stage = "decided";
      progressCondition = "実行結果が記録されること";
    }
  } else if (decisions.length > 0) {
    stage = "decided";
    progressCondition = "実行するアクション（担当・期限）が記録されること";
  } else if (proposals.length > 1) {
    stage = "comparing_options";
    progressCondition = "いずれかの案が決定として採用されること";
  } else if (proposals.length === 1) {
    stage = "generating_options";
    progressCondition = "比較できる案が増えるか、この案が決定されること";
  } else if (problems.length > 0 && reasons.length > 0) {
    stage = "organizing_reasons";
    progressCondition = "対応方針や提案が出ること";
  } else if (problems.length > 0) {
    stage = "confirming_problem";
    progressCondition = "課題の理由・背景が確認されること";
  } else if (scopedNodes.length === 0) {
    stage = "unknown";
    progressCondition = null;
  } else {
    // Only evidence/concern/risk/utterance-level activity with nothing that
    // cleanly maps to a stage above: don't force a single label.
    stage = "ambiguous";
    progressCondition = null;
  }

  let topicTitle: string;
  let topicTitleSource: TopicTitleSource;
  if (currentTopicNode && isWellFormedTopicTitle(currentTopicNode.title)) {
    topicTitle = currentTopicNode.title;
    topicTitleSource = "extracted_topic";
  } else if (unresolvedQuestion) {
    topicTitle = truncate(unresolvedQuestion.label, MAX_TITLE_LENGTH);
    topicTitleSource = "unresolved_question";
  } else if (segments.length > 0) {
    topicTitle = truncate(segments[segments.length - 1].text, MAX_TITLE_LENGTH);
    topicTitleSource = "recent_utterance";
  } else {
    topicTitle = "論点を特定できません";
    topicTitleSource = "unknown";
  }

  return {
    topicTitle,
    topicTitleSource,
    stage,
    unresolvedQuestion,
    progressCondition,
    decisionThemeTitle: decisions.length > 0 ? topicTitle : null,
    counts: {
      confirmedDecisions: decisions.length,
      structuralGaps: actions.filter(isActionMissingOwnerOrDeadline).length,
      unresolvedItems: unresolvedQuestions.length,
      nextActions: actions.length,
    },
  };
}
