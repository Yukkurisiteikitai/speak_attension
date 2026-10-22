import type { AnalyzedSegment, ConversationTreeState, MeetingDecisionGraph, MissingContribution } from "../types/topic";
import { actionStatusLabels, meetingTypeLabels } from "./meetingState";

export type PlannedBranch = { condition: string; next: string };
export type DiscussionPrompt = {
  id: string;
  anchorSegmentId: string;
  evidenceSegmentIds: string[];
  actionId: string | null;
  kind: string;
  question: string;
  rationale: string;
  branches: PlannedBranch[];
  source: "rules" | "ai";
  status: "open" | "deferred" | "answered" | "satisfied";
  answerSegmentId?: string;
  answerSegmentIds?: string[];
  parentPromptId?: string;
};
export type ProgressNode = {
  id: string;
  parentId: string | null;
  label: string;
  kind: string;
  segmentId?: string;
  promptId?: string;
  sequence?: number;
  planned: boolean;
};
export type ProgressLink = { source: string; target: string; label: string; kind: "reason" | "sequence" | "answer" };
export type MeetingProgress = { nodes: ProgressNode[]; links: ProgressLink[]; prompts: DiscussionPrompt[] };

function branchesFor(kind: string): PlannedBranch[] {
  if (kind === "missing_decision" || kind === "compare") return [
    { condition: "採用する案を選べたら", next: "選んだ理由と見送った案を記録し、担当・期限を決める" },
    { condition: "まだ選べなければ", next: "比較の基準と追加で調べる事実を決める" },
  ];
  return [
    { condition: "確認できたら", next: "回答を根拠に方針・次の行動を具体化する" },
    { condition: "まだ分からなければ", next: "調査する人・確認期限・判断を再開する条件を決める" },
  ];
}

// Stable keys describe an information gap, not the transient IDs of topic gaps.
export function buildDiscussionPrompts(
  graph: MeetingDecisionGraph, segments: AnalyzedSegment[], contributions: MissingContribution[],
  previous: DiscussionPrompt[] = [],
): DiscussionPrompt[] {
  const ids = new Set(segments.map((segment) => segment.id));
  const candidates: DiscussionPrompt[] = [];
  const add = (id: string, evidence: string[], kind: string, question: string, rationale: string, actionId: string | null = null) => {
    const valid = evidence.filter((id) => ids.has(id));
    if (!valid.length || candidates.some((prompt) => prompt.id === id)) return;
    candidates.push({ id, anchorSegmentId: valid[valid.length - 1], evidenceSegmentIds: valid, actionId, kind,
      question, rationale, branches: branchesFor(kind), source: "rules", status: "open" });
  };
  for (const gap of contributions) {
    add(`prompt-${gap.kind === "unresolved_question" ? gap.id : gap.relatedActionId ?? gap.topicId}-${gap.kind}`, gap.evidenceSegmentIds, gap.kind, gap.question, gap.rationale, gap.relatedActionId);
  }
  const adopted = new Set(graph.edges.filter((edge) => edge.relation === "decided_from").map((edge) => edge.target));
  for (const node of graph.nodes) {
    if (node.type === "proposal" && !adopted.has(node.id)) {
      add(`prompt-${node.id}-compare`, node.provenance.utteranceIds, "compare", `「${node.label}」を選ぶ基準と、比較する別案は何ですか？`, "提案から決定へのつながりがまだ記録されていません。");
    }
    if (node.state === "unconfirmed") {
      add(`prompt-${node.id}-verify`, node.provenance.utteranceIds, "verify", `「${node.label}」を確かめるには何を調べますか？`, "未確認の見立てです。判断に使う前に確認が必要です。");
    }
  }
  // Even a conversation without recognized topic keywords gets a next step.
  const latest = segments[segments.length - 1];
  if (!candidates.length && latest && !graph.nodes.some((node) => node.type === "decision")) {
    add("prompt-meeting-goal", [segments[0].id], "goal", "この会議で何を決めたいですか？ 判断に必要な事実は揃っていますか？", "会議の到達点と判断の材料を確認します。");
  }
  const prior = new Map(previous.map((prompt) => [prompt.id, prompt]));
  const next = candidates.map((candidate) => {
    const old = prior.get(candidate.id);
    if (!old) return candidate;
    if (old.status === "answered") return old;
    // Re-evaluate prose against current evidence; keep explicit answers/defer.
    return { ...candidate, status: old.status === "satisfied" ? "open" as const : old.status,
      answerSegmentId: old.answerSegmentId, answerSegmentIds: old.answerSegmentIds, anchorSegmentId: old.anchorSegmentId };
  });
  const currentIds = new Set(next.map((prompt) => prompt.id));
  for (const old of previous) {
    if (!currentIds.has(old.id)) next.push({ ...old, status: old.kind === "followup" || old.status === "answered" ? old.status : "satisfied" });
  }
  return next.sort((a, b) => Number(b.kind === "followup" && b.status === "open") - Number(a.kind === "followup" && a.status === "open"));
}

export function recordDiscussionAnswer(prompts: DiscussionPrompt[], prompt: DiscussionPrompt, answerSegmentId: string, needsResearch: boolean): DiscussionPrompt[] {
  const branch = prompt.branches[needsResearch ? 1 : 0];
  const answered = prompts.map((item) => item.id === prompt.id ? { ...prompt, status: "answered" as const, answerSegmentId, answerSegmentIds: [...(prompt.answerSegmentIds ?? []), answerSegmentId] } : item);
  return [{ ...prompt, id: `${prompt.id}-followup-${answerSegmentId}`, parentPromptId: prompt.id,
    anchorSegmentId: answerSegmentId, evidenceSegmentIds: [...prompt.evidenceSegmentIds, answerSegmentId], kind: "followup", actionId: null,
    question: `${branch.next}。具体的にはどう進めますか？`, rationale: `「${prompt.question}」への回答を受けた次の検討です（${branch.condition}）。`,
    status: "open", answerSegmentId: undefined, answerSegmentIds: [] }, ...answered];
}

export function buildMeetingProgress(
  tree: ConversationTreeState, graph: MeetingDecisionGraph, segments: AnalyzedSegment[], prompts: DiscussionPrompt[],
): MeetingProgress {
  const nodes: ProgressNode[] = [{ id: "progress-root", parentId: null, label: "会議の進行と考えのまとまり", kind: "会議", planned: false }];
  const links: ProgressLink[] = [];
  const segmentIndex = new Map(segments.map((segment, index) => [segment.id, index + 1]));
  const segmentNode = new Map<string, string>();
  const decisionToSegment = new Map(graph.nodes.map((node) => [node.id, node.provenance.utteranceIds[0]]));
  const roles = { topic: "議題", issue: "課題", cause: "理由", action: "行動案", alternative: "別案", statement: "発言" };
  const priority = ["decision", "proposal", "question", "risk", "reason", "problem", "evidence"];
  for (const item of tree.nodes) {
    const facts = graph.nodes.filter((node) => node.provenance.utteranceIds.includes(item.segmentId));
    const semantic = priority.map((type) => facts.find((node) => node.type === type)).find(Boolean);
    const references = graph.edges.filter((edge) => facts.some((node) => node.id === edge.source) && edge.relation !== "derived_from");
    references.sort((a, b) => Number(b.relation === "decided_from") - Number(a.relation === "decided_from"));
    const parents = references.map((edge) => ({ edge, id: segmentNode.get(decisionToSegment.get(edge.target) ?? "") }))
      .filter((ref, index, refs) => ref.id && refs.findIndex((other) => other.id === ref.id) === index);
    const parentId = item.manuallyAdjusted ? item.parentId : parents[0]?.id ?? item.parentId;
    const kind = item.role === "topic" || item.role === "alternative" ? roles[item.role] : semantic ? meetingTypeLabels[semantic.type] : roles[item.role];
    nodes.push({ id: item.id, parentId: parentId ?? "progress-root", label: item.originalText, kind: semantic?.state === "unconfirmed" ? `${kind}・未確認` : kind,
      sequence: segmentIndex.get(item.segmentId), segmentId: item.segmentId, planned: false });
    segmentNode.set(item.segmentId, item.id);
    for (const ref of parents) {
      if (ref.id !== parentId) links.push({ source: ref.id!, target: item.id, label: ref.edge.relation === "decided_from" ? "採用へ" : "関連候補", kind: "reason" });
    }
  }
  // Closure and answers can be absent from the semantic tree. Preserve them in
  // the flow as well so the ordered record is complete (including short replies).
  for (const segment of segments) {
    if (segmentNode.has(segment.id)) continue;
    const id = `progress-${segment.id}`;
    nodes.push({ id, parentId: "progress-root", label: segment.text, kind: "発言・進行", segmentId: segment.id, sequence: segmentIndex.get(segment.id), planned: false });
    segmentNode.set(segment.id, id);
  }
  for (let index = 1; index < segments.length; index++) {
    links.push({ source: segmentNode.get(segments[index - 1].id)!, target: segmentNode.get(segments[index].id)!, label: "次の発言", kind: "sequence" });
  }
  for (const record of graph.nodes.filter((node) => node.type === "outcome" && node.actionChange)) {
    const change = record.actionChange!;
    const anchor = segmentNode.get(decisionToSegment.get(change.actionId) ?? "");
    if (!anchor) continue;
    nodes.push({ id: record.id, parentId: anchor, kind: "実行結果・更新", planned: false,
      label: `${actionStatusLabels[change.before.status ?? "decided"]} → ${actionStatusLabels[change.after.status ?? "decided"]}：${record.label}` });
  }
  for (const prompt of prompts) {
    const anchor = segmentNode.get(prompt.anchorSegmentId);
    if (!anchor) continue;
    nodes.push({ id: prompt.id, parentId: anchor, label: prompt.question, kind: prompt.status === "answered" ? "回答を記録済み" : prompt.status === "satisfied" ? "確認項目の更新済み" : prompt.status === "deferred" ? "後で検討" : "次の問い",
      promptId: prompt.id, planned: true });
    if (prompt.status === "open" || prompt.status === "deferred") prompt.branches.forEach((branch, index) => {
      nodes.push({ id: `${prompt.id}-branch-${index}`, parentId: prompt.id, label: `${branch.condition}：${branch.next}`, kind: "予定・条件付き", promptId: prompt.id, planned: true });
    });
    for (const answerId of prompt.answerSegmentIds ?? (prompt.answerSegmentId ? [prompt.answerSegmentId] : [])) {
      const answer = segmentNode.get(answerId);
      if (answer) links.push({ source: prompt.id, target: answer, label: "この問いへの回答", kind: "answer" });
    }
  }
  return { nodes, links, prompts };
}

export function renderMeetingProgressMarkdown(progress: MeetingProgress, segments: AnalyzedSegment[]): string {
  const lines = ["# 会議の進行・検討計画", "", "関連線はルールによる候補。予定は未決定の検討手順です。", "", "## 発言の流れ"];
  segments.forEach((segment, index) => lines.push(`\n${index + 1}. ${segment.text}\n   出典: ${segment.id} / ${segment.metadata?.speaker ?? "発言者不明"} / ${new Date(segment.createdAt).toISOString()}`));
  lines.push("", "## 考えのつながり");
  const byId = new Map(progress.nodes.map((node) => [node.id, node]));
  progress.nodes.filter((node) => !node.planned && node.parentId).forEach((node) => lines.push(`- ${byId.get(node.parentId!)?.label} → ${node.kind}: ${node.label}`));
  lines.push("", "## 次の問いと予定系統");
  const states = { open: "未回答", deferred: "保留", answered: "回答記録済み", satisfied: "更新済み" };
  progress.prompts.forEach((prompt) => {
    lines.push(`\n- [${states[prompt.status]} / ${prompt.source === "ai" ? "AI提案" : "ルール提案"}] ${prompt.question}`, `  - 理由: ${prompt.rationale}`, `  - 出典: ${prompt.evidenceSegmentIds.join(", ")}`);
    prompt.branches.forEach((branch) => lines.push(`  - ${branch.condition}: ${branch.next}`));
    for (const answerId of prompt.answerSegmentIds ?? (prompt.answerSegmentId ? [prompt.answerSegmentId] : [])) {
      lines.push(`  - 回答: ${segments.find((segment) => segment.id === answerId)?.text ?? ""} (${answerId})`);
    }
  });
  return lines.join("\n") + "\n";
}
