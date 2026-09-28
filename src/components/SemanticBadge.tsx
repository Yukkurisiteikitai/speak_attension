import {
  MessageSquare, ListOrdered, FileText, AlertCircle, Link2, BarChart2,
  GitCompare, Lightbulb, CheckCircle2, ListChecks, HelpCircle, MessageCircle,
  Circle, PauseCircle,
} from "lucide-react";
import type { SemanticRole } from "../semantic/types";
import type { TimelineUnitRow } from "../semantic/timelineProjection";
import {
  actLabels, basisLabels, commitmentLabels, isSettledCommitment, roleLabels, scopeLabels,
} from "../semantic/labels";

type SemanticBadgeProps = {
  unit: TimelineUnitRow;
};

const roleIcons: Record<SemanticRole, typeof MessageSquare> = {
  topic: MessageSquare,
  agenda_item: ListOrdered,
  context: FileText,
  problem: AlertCircle,
  reason: Link2,
  evidence: BarChart2,
  option: GitCompare,
  proposal: Lightbulb,
  decision: CheckCircle2,
  action: ListChecks,
  question: HelpCircle,
  acknowledgement: MessageCircle,
  other: Circle,
};

// Reads the projection's axes; it does not classify anything itself.
export function SemanticBadge({ unit }: SemanticBadgeProps) {
  const { scope, role, act, commitment } = unit.axes;
  const Icon = act === "defer" ? PauseCircle : roleIcons[role];
  const corrected = unit.humanOverriddenAxes.length > 0;

  // Icon, label and colour together -- never colour alone.
  const strength = isSettledCommitment(commitment) ? "is-confirmed" : "is-tentative";
  const title = [
    `${roleLabels[role]}（${actLabels[act]}・${commitmentLabels[commitment]}）`,
    `範囲: ${scopeLabels[scope]}`,
    unit.promotion ? `会議の状況: ${basisLabels[unit.promotion.basis]}` : "会議の状況には未反映",
    corrected ? `参加者が修正: ${unit.humanOverriddenAxes.join(", ")}` : null,
  ].filter(Boolean).join(" / ");

  return (
    <span className={`semantic-badge role-${role} ${strength} ${corrected ? "is-corrected" : ""}`} title={title}>
      <Icon size={13} aria-hidden="true" />
      <span className="semantic-badge-role">{roleLabels[role]}</span>
      <span className="semantic-badge-meta">
        {actLabels[act]} ・ {commitmentLabels[commitment]}
      </span>
      <span className="semantic-badge-scope">{scopeLabels[scope]}</span>
      {unit.promotion ? (
        // Shows what reached canonical state and on whose authority, so a rule's
        // reading is never displayed as a confirmed fact.
        <span className="semantic-badge-basis">{basisLabels[unit.promotion.basis]}</span>
      ) : null}
      {unit.conflictingAxes.length > 0 ? (
        <span className="semantic-badge-conflict" title="参加者の修正と自動解析が異なります">
          自動解析と相違
        </span>
      ) : null}
    </span>
  );
}
