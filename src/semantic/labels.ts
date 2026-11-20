// Japanese display labels for the semantic axes.
//
// Single definition, shared by every projection, so two surfaces cannot show
// different wording for the same axis value. UI shows these labels, never the
// internal identifiers.

import type { CanonicalKind, Commitment, DiscourseAct, PromotionBasis, Scope, SemanticRole } from "./types";

export const scopeLabels: Record<Scope, string> = {
  meeting_process: "会議の進行",
  subject_matter: "議題の中身",
  artifact_content: "成果物の中身",
  unknown: "不明",
};

export const roleLabels: Record<SemanticRole, string> = {
  topic: "話題",
  agenda_item: "議題項目",
  context: "背景・前提",
  problem: "課題",
  reason: "理由",
  evidence: "根拠",
  option: "選択肢",
  proposal: "提案",
  decision: "決定",
  action: "アクション",
  question: "質問",
  acknowledgement: "相づち・短い応答",
  other: "その他",
};

export const actLabels: Record<DiscourseAct, string> = {
  topic_start: "論点開始",
  enumerate: "列挙",
  report: "報告",
  ask: "質問",
  suggest: "示唆",
  advocate: "支持",
  oppose: "反対",
  decide: "決定",
  commit: "実行宣言",
  defer: "保留",
  acknowledge: "相づち",
  other: "その他",
};

export const commitmentLabels: Record<Commitment, string> = {
  none: "未確定",
  mentioned: "言及のみ",
  considered: "検討中",
  proposed: "未採用",
  accepted: "支持あり",
  decided: "確定",
  committed: "実行確約",
  deferred: "保留",
  rejected: "却下",
};

// Deliberately worded so a rule's reading can never read as a person's
// confirmation (ADR 0018, ADR 0023 §6).
export const basisLabels: Record<PromotionBasis, string> = {
  provisional: "暫定（自動・未確認）",
  rule_explicit: "規則が判定（未確認）",
  human_confirmed: "参加者が確認",
};

export const canonicalKindLabels: Record<CanonicalKind, string> = {
  topic: "話題",
  context: "背景・前提",
  problem: "課題",
  option: "選択肢",
  proposal: "提案",
  decision: "決定",
  action: "アクション",
  deferred: "保留",
  question: "質問",
  unresolved: "未分類",
};

// A commitment that asserts something was settled. Used by the UI to decide
// display strength; it must not be used to decide promotion.
export function isSettledCommitment(commitment: Commitment): boolean {
  return commitment === "accepted" || commitment === "decided" || commitment === "committed";
}

export const itemKindLabels = {
  decision: "決定", action: "タスク", schedule: "日程", proposal: "提案", issue: "課題",
} as const;

export const semanticStateLabels = {
  candidate: "候補", agreed: "会議で合意", deferred: "会議で保留", rejected: "却下",
  withdrawn: "撤回", superseded: "後続の内容に差し替え",
} as const;

export const reviewStateLabels = {
  pending: "要確認", auto_recorded: "自動記録済み", human_verified: "人間確認済み",
  held: "保留", dismissed: "除外",
} as const;

export const riskLabels = { low: "低", medium: "中", high: "高" } as const;
export const itemFieldLabels = { content: "記録内容", owner: "担当者", deadline: "期限・日時", target: "対象", condition: "条件" } as const;

export const reviewActionLabels = {
  ItemAutoRecorded: "自動記録", ItemHumanVerified: "記録上確定", ItemHeld: "保留",
  ItemDismissed: "除外", ItemCorrected: "訂正", ItemReviewReopened: "再審査",
  ItemWithdrawn: "発言の撤回", ItemSuperseded: "後続の内容に差し替え", ReviewActionReverted: "確認操作の取り消し",
} as const;
