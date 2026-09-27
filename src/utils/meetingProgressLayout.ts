import { Position, type Edge, type Node } from "@xyflow/react";
import type { MeetingProgress } from "./meetingProgress";

export type ProgressNodeCategory = "topic" | "issue" | "reason" | "proposal" | "risk" | "decision" | "action" | "planned" | "unconfirmed" | "neutral";

export function categorizeProgressKind(kind: string): ProgressNodeCategory {
  if (kind.includes("未確認")) return "unconfirmed";
  if (kind === "会議" || kind === "議題") return "topic";
  if (kind === "課題" || kind === "質問" || kind === "次の問い") return "issue";
  if (kind === "理由" || kind === "根拠") return "reason";
  if (kind === "提案" || kind === "行動案") return "proposal";
  if (kind === "リスク" || kind === "懸念") return "risk";
  if (kind === "決定" || kind.startsWith("実行結果") || kind.startsWith("回答を記録") || kind.startsWith("確認項目の更新")) return "decision";
  if (kind === "アクション") return "action";
  if (kind === "予定・条件付き" || kind === "後で検討") return "planned";
  return "neutral";
}

export const PROGRESS_CATEGORY_META: Record<ProgressNodeCategory, { label: string; icon: "MessageSquare" | "HelpCircle" | "FileText" | "Lightbulb" | "AlertTriangle" | "CheckCircle2" | "ListChecks" | "Clock" | "AlertCircle"; colorHex: string }> = {
  topic: { label: "話題", icon: "MessageSquare", colorHex: "#116147" },
  issue: { label: "課題・質問", icon: "HelpCircle", colorHex: "#b1423a" },
  reason: { label: "理由・根拠", icon: "FileText", colorHex: "#52615a" },
  proposal: { label: "提案", icon: "Lightbulb", colorHex: "#8a5a12" },
  risk: { label: "リスク", icon: "AlertTriangle", colorHex: "#a52825" },
  decision: { label: "決定・実行", icon: "CheckCircle2", colorHex: "#176b50" },
  action: { label: "アクション", icon: "ListChecks", colorHex: "#4756a6" },
  planned: { label: "検討予定", icon: "Clock", colorHex: "#8a5a12" },
  unconfirmed: { label: "未確認", icon: "AlertCircle", colorHex: "#8a5a12" },
  neutral: { label: "発言", icon: "MessageSquare", colorHex: "#5c6b64" },
};

export function projectMeetingProgress(progress: MeetingProgress, showSequence: boolean): { nodes: Node[]; edges: Edge[] } {
  const children = new Map<string, typeof progress.nodes>();
  for (const node of progress.nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const positions = new Map<string, { x: number; y: number }>();
  let row = 0;
  const visiting = new Set<string>();
  function place(id: string, depth: number): number {
    if (visiting.has(id)) return row * 188;
    visiting.add(id);
    const branch = children.get(id) ?? [];
    const ys = branch.map((node) => place(node.id, depth + 1));
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++ * 188;
    positions.set(id, { x: depth * 390, y });
    return y;
  }
  place("progress-root", 0);
  return {
    nodes: progress.nodes.map((node) => {
      const category = categorizeProgressKind(node.kind);
      return {
        id: node.id,
        type: "progress",
        position: positions.get(node.id) ?? { x: 0, y: row++ * 188 },
        data: {
          label: `${node.sequence ? `${node.sequence}. ` : ""}${node.kind}\n${Array.from(node.label).slice(0, 50).join("")}${Array.from(node.label).length > 50 ? "…" : ""}`,
          category,
          kind: node.kind,
          planned: node.planned,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        // background/border are drawn by the ProgressNodeView custom node
        // component (category-driven left border + chip), not here — the
        // sizing below still matters since the custom node fills this box.
        style: {
          width: 290,
          height: 150,
        },
      };
    }),
    edges: [
      ...progress.nodes.filter((node) => node.parentId).map((node) => ({ id: `parent-${node.id}`, source: node.parentId!, target: node.id,
        type: "smoothstep", label: node.planned ? "検討の予定" : undefined, style: node.planned ? { strokeDasharray: "5 4", stroke: "#b67b29" } : { stroke: "#598471" } })),
      ...progress.links.filter((link) => link.kind !== "sequence" || showSequence).map((link, index) => ({ id: `link-${index}`, source: link.source, target: link.target,
        label: link.label, style: { stroke: link.kind === "sequence" ? "#8295b8" : "#35786a", strokeDasharray: link.kind === "sequence" ? "2 5" : undefined } })),
    ],
  };
}
