import type { UtteranceClassification } from "../utils/utteranceClassification";
import {
  MessageSquare,
  ListOrdered,
  FileText,
  AlertCircle,
  Link2,
  BarChart2,
  GitCompare,
  Lightbulb,
  CheckCircle2,
  ListChecks,
  HelpCircle,
  MessageCircle,
  Circle,
} from "lucide-react";

type SemanticBadgeProps = {
  classification: UtteranceClassification;
};

// Semantic role labels and icons
const semanticRoleConfig = {
  topic: { label: "話題", Icon: MessageSquare },
  agenda_item: { label: "議題項目", Icon: ListOrdered },
  context: { label: "背景・前提", Icon: FileText },
  problem: { label: "課題", Icon: AlertCircle },
  reason: { label: "理由", Icon: Link2 },
  evidence: { label: "根拠", Icon: BarChart2 },
  option: { label: "選択肢", Icon: GitCompare },
  proposal: { label: "提案", Icon: Lightbulb },
  decision: { label: "決定", Icon: CheckCircle2 },
  action: { label: "アクション", Icon: ListChecks },
  question: { label: "質問", Icon: HelpCircle },
  acknowledgement: { label: "相づち・短い応答", Icon: MessageCircle },
  other: { label: "その他", Icon: Circle },
} as const;

// Discourse act labels
const discourseActConfig = {
  topic_start: "論点開始",
  enumerate: "列挙",
  report: "報告",
  ask: "質問",
  suggest: "示唆",
  advocate: "主張",
  decide: "決定",
  commit: "実行宣言",
  acknowledge: "相づち",
  other: "その他",
} as const;

// Commitment labels
const commitmentConfig = {
  none: "未確定",
  mentioned: "言及のみ",
  considered: "検討中",
  proposed: "未採用",
  accepted: "合意",
  decided: "確定",
  committed: "実行確約",
  rejected: "却下",
} as const;

/**
 * Determines if a commitment level is "strong" (confirmed/decided/committed)
 * vs. "weak" (tentative/proposed/considered/none).
 */
function isConfirmedCommitment(commitment: UtteranceClassification["commitment"]): boolean {
  return ["accepted", "decided", "committed"].includes(commitment);
}

export function SemanticBadge({ classification }: SemanticBadgeProps) {
  const { semanticRole, discourseAct, commitment, owner, deadline } = classification;

  const roleConfig = semanticRoleConfig[semanticRole];
  const discourseActLabel = discourseActConfig[discourseAct];
  const commitmentLabel = commitmentConfig[commitment];
  const { Icon } = roleConfig;

  // Build title attribute with full explanation
  const title = `${roleConfig.label}（${discourseActLabel}・${commitmentLabel}）`;

  // Determine strength modifier class based on commitment
  const strengthModifier = isConfirmedCommitment(commitment) ? "is-confirmed" : "is-tentative";

  return (
    <span
      className={`semantic-badge role-${semanticRole} ${strengthModifier}`}
      title={title}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="semantic-badge-role">{roleConfig.label}</span>
      <span className="semantic-badge-meta">
        {discourseActLabel} ・ {commitmentLabel}
      </span>
      {semanticRole === "action" && (
        <span className="semantic-badge-detail">
          {owner ?? "未割当"} / {deadline ?? "期限未設定"}
        </span>
      )}
    </span>
  );
}
