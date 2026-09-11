import type { MeetingDecisionGraph, MeetingDecisionNode } from "../types/topic";
import { selectCurrentActions, selectUnresolvedQuestions } from "./meetingDecisionGraph";

export const meetingTypeLabels: Record<MeetingDecisionNode["type"], string> = {
  utterance: "元の発言", problem: "課題", question: "質問", evidence: "根拠", proposal: "提案",
  reason: "理由", concern: "懸念", risk: "リスク", decision: "決定", action: "アクション", outcome: "結果・更新記録",
};
export const meetingStateLabels = {
  human_stated: "参加者の発言", decided: "決定済み", proposed: "提案", ai_suggested: "AI提案", unconfirmed: "未確認",
};
export const actionStatusLabels = { proposed: "提案中", decided: "決定済み", in_progress: "実行中", done: "完了", cancelled: "撤回" };
export const actionUrgencyLabels = { low: "低", medium: "中", high: "高", critical: "最優先" };

export function selectPendingMeetingNodes(graph: MeetingDecisionGraph): MeetingDecisionNode[] {
  const questions = new Set(selectUnresolvedQuestions(graph).map((node) => node.id));
  const adopted = new Set(graph.edges.filter((edge) => edge.relation === "decided_from").map((edge) => edge.target));
  return graph.nodes.filter((node) => questions.has(node.id)
    || (node.type === "proposal" && !adopted.has(node.id))
    || (node.type === "action" && node.action?.status === "proposed")
    || node.state === "unconfirmed" || node.state === "ai_suggested");
}

export function buildMeetingStateSnapshot(graph: MeetingDecisionGraph, meeting: { meetingId: string; title: string }, exportedAt: number) {
  // Detach the export from mutable callers; include every original utterance and edge.
  return {
    format: "meeting-state", version: 1, ...meeting, exportedAt,
    currentActionIds: selectCurrentActions(graph).map((node) => node.id),
    pendingNodeIds: selectPendingMeetingNodes(graph).map((node) => node.id),
    graph: structuredClone(graph),
  };
}

export function renderMeetingStateMarkdown(snapshot: ReturnType<typeof buildMeetingStateSnapshot>): string {
  const { graph } = snapshot;
  const lines = [`# 会議の現在状態: ${snapshot.title}`, "", `出力日時: ${new Date(snapshot.exportedAt).toISOString()}`,
    "", "関連線はルールによる候補です。元発言を確認してください。音声は保存していません。", "", "## 今すること"];
  const link = (node: MeetingDecisionNode) => `[${meetingTypeLabels[node.type]}: ${node.label.replace(/[\[\]\n\r]/g, " ")}](#${node.id})`;
  const current = new Set(snapshot.currentActionIds);
  const pending = new Set(snapshot.pendingNodeIds);
  for (const node of graph.nodes.filter((node) => current.has(node.id))) lines.push(`- ${link(node)}`);
  if (!current.size) lines.push("決定済みのアクションはありません。");
  lines.push("", "## 未決定・確認が必要な項目");
  for (const node of graph.nodes.filter((node) => pending.has(node.id))) lines.push(`- ${link(node)}`);
  if (!pending.size) lines.push("未決定・未確認の項目はありません。");
  lines.push("", "## 決定・結果・出典");
  for (const node of graph.nodes) {
    lines.push("", `<a id="${node.id}"></a>`, `### ${meetingTypeLabels[node.type]}: ${node.label.replace(/[\n\r]/g, " ")}`,
      `${meetingStateLabels[node.state]} / ${new Date(node.createdAt).toISOString()} / ${node.speaker ?? "発言者不明"}`);
    if (node.action) {
      const a = node.action;
      lines.push(`- 担当: ${a.owner ?? "未割当"} / 期限: ${a.deadline ?? "未設定"}`,
        `- 状態: ${actionStatusLabels[a.status ?? "decided"]} / 優先度: ${a.urgency ? actionUrgencyLabels[a.urgency] : "未設定"}`,
        `- 理由: ${a.why ?? "未確認"}`, `- 今やる理由: ${a.whyNow ?? "未確認"}`);
    }
    const targets = new Set(graph.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target));
    for (const parent of graph.nodes.filter((candidate) => targets.has(candidate.id))) lines.push(`- 出典・関連: ${link(parent)}`);
  }
  return lines.join("\n") + "\n";
}
