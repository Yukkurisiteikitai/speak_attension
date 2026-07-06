import type { CoverageUpdate, TopicCoverage, TopicCoverageKey, TopicDisplayState, TopicGap, TopicGapSeverity, TopicGapType, TopicNode } from "../types/topic";

const DECISION_PATTERNS = ["決定", "決める", "決めます", "採用", "方針", "結論"];
const REASON_PATTERNS = ["理由", "なぜなら", "ので", "ため", "からです", "背景"];
const OWNER_PATTERNS = ["担当", "私が", "自分が", "さんが", "チームが"];
const DUE_DATE_PATTERNS = ["まで", "期限", "締切", "今週", "来週", "月曜", "火曜", "水曜", "木曜", "金曜"];
const NEXT_ACTION_PATTERNS = ["やる", "確認する", "対応する", "進める", "詰める", "出す"];
const RISK_PATTERNS = ["リスク", "懸念", "不安", "まずい", "危ない"];
const ALTERNATIVE_PATTERNS = ["別案", "他の案", "代替", "別の方法", "別パターン"];
const OBJECTION_PATTERNS = ["反対", "でも", "懸念", "ただ", "一方で"];
const DEPENDENCY_PATTERNS = ["依存", "先に", "終わってから", "待ち", "前提"];
const QUESTION_PATTERNS = ["?", "？", "どう", "なぜ", "いつ", "誰", "何", "どこ", "ますか", "ですか"];
const DATE_LIKE_PATTERN = /(\d{1,2}\/\d{1,2}|\d{1,2}日|[0-9]{4}-[0-9]{2}-[0-9]{2}|明日|今日|今週|来週)/;

const GAP_PRIORITIES: Record<TopicGapType, { severity: TopicGapSeverity; title: string; detail: string }> = {
  shallow: {
    severity: "medium",
    title: "浅い議論",
    detail: "短く触れただけで、論点の掘り下げが不足しています。",
  },
  missing_decision: {
    severity: "high",
    title: "決定不足",
    detail: "結論か未解決の明示がありません。",
  },
  missing_reason: {
    severity: "medium",
    title: "理由不足",
    detail: "提案や決定に対する理由が残っていません。",
  },
  missing_owner: {
    severity: "high",
    title: "担当不足",
    detail: "次アクションに担当が紐付いていません。",
  },
  missing_due_date: {
    severity: "medium",
    title: "期限不足",
    detail: "次アクションに期限がありません。",
  },
  missing_next_action: {
    severity: "high",
    title: "次アクション不足",
    detail: "決定または未解決事項に対する次の一手がありません。",
  },
  missing_risk: {
    severity: "medium",
    title: "リスク確認不足",
    detail: "リスクや懸念の確認が足りていません。",
  },
  missing_alternative: {
    severity: "medium",
    title: "代替案不足",
    detail: "別案や反対意見の検討がありません。",
  },
  unresolved: {
    severity: "high",
    title: "未解決",
    detail: "疑問が残ったまま閉じています。",
  },
};

function severityWeight(severity: TopicGapSeverity): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function createEmptyCoverage(): TopicCoverage {
  return {
    decision: false,
    reason: false,
    owner: false,
    dueDate: false,
    risk: false,
    alternative: false,
    objection: false,
    nextAction: false,
    dependency: false,
    openQuestionResolved: false,
  };
}

function includesAny(text: string, patterns: string[]): string | null {
  return patterns.find((pattern) => text.includes(pattern)) ?? null;
}

export function detectCoverageUpdates(text: string): CoverageUpdate[] {
  const updates: CoverageUpdate[] = [];

  const map: Array<[TopicCoverageKey, string | null]> = [
    ["decision", includesAny(text, DECISION_PATTERNS)],
    ["reason", includesAny(text, REASON_PATTERNS)],
    ["owner", includesAny(text, OWNER_PATTERNS)],
    ["dueDate", includesAny(text, DUE_DATE_PATTERNS)],
    ["nextAction", includesAny(text, NEXT_ACTION_PATTERNS)],
    ["risk", includesAny(text, RISK_PATTERNS)],
    ["alternative", includesAny(text, ALTERNATIVE_PATTERNS)],
    ["objection", includesAny(text, OBJECTION_PATTERNS)],
    ["dependency", includesAny(text, DEPENDENCY_PATTERNS)],
  ];

  for (const [key, matchedText] of map) {
    if (matchedText) updates.push({ key, matchedText });
  }

  if (DATE_LIKE_PATTERN.test(text) && !updates.some((update) => update.key === "dueDate")) {
    updates.push({ key: "dueDate", matchedText: text.match(DATE_LIKE_PATTERN)?.[0] ?? "date" });
  }

  if (QUESTION_PATTERNS.some((pattern) => text.includes(pattern))) {
    updates.push({ key: "openQuestionResolved", matchedText: "question_detected" });
  }

  return updates;
}

export function deriveLifecycle(node: TopicNode, hasUnresolvedQuestion: boolean): TopicNode["lifecycle"] {
  if (node.lastActivatedAt && !node.closedAt) return "active";
  if (hasUnresolvedQuestion) return "unresolved";
  if (node.coverage.decision) return "decided";
  return "discussed";
}

export function deriveDisplayStates(node: TopicNode, gaps: TopicGap[], hasUnresolvedQuestion: boolean): TopicDisplayState[] {
  const states = new Set<TopicDisplayState>();
  if (node.lastActivatedAt && !node.closedAt) states.add("active");
  else states.add("discussed");
  if (node.coverage.decision) states.add("decided");
  if (hasUnresolvedQuestion) states.add("unresolved");
  if (node.mentionCount < 2) states.add("shallow");
  if (gaps.some((gap) => gap.type !== "shallow")) states.add("missing");
  return [...states];
}

export function buildTopicGaps(node: TopicNode, hasUnresolvedQuestion: boolean, now: number): TopicGap[] {
  const gaps: TopicGapType[] = [];
  const filledCount = Object.values(node.coverage).filter(Boolean).length;

  if (node.mentionCount < 2 || filledCount <= 2) gaps.push("shallow");
  if (!node.coverage.decision && !hasUnresolvedQuestion) gaps.push("missing_decision");
  if ((node.coverage.decision || node.coverage.nextAction) && !node.coverage.reason) gaps.push("missing_reason");
  if (node.coverage.nextAction && !node.coverage.owner) gaps.push("missing_owner");
  if (node.coverage.nextAction && !node.coverage.dueDate) gaps.push("missing_due_date");
  if ((node.coverage.decision || hasUnresolvedQuestion) && !node.coverage.nextAction) gaps.push("missing_next_action");
  if ((node.coverage.decision || node.coverage.nextAction) && !node.coverage.risk && !node.coverage.objection) gaps.push("missing_risk");
  if ((node.coverage.decision || node.coverage.nextAction) && !node.coverage.alternative && !node.coverage.objection) {
    gaps.push("missing_alternative");
  }
  if (hasUnresolvedQuestion) gaps.push("unresolved");

  return gaps.map((type) => {
    const meta = GAP_PRIORITIES[type];
    return {
      id: `${node.id}-${type}`,
      topicId: node.id,
      type,
      title: meta.title,
      detail: meta.detail,
      severity: meta.severity,
      createdAt: now,
      closedAt: null,
    };
  });
}

export function sortGaps(gaps: TopicGap[]): TopicGap[] {
  return [...gaps].sort((left, right) => {
    return (
      severityWeight(right.severity) - severityWeight(left.severity) ||
      right.createdAt - left.createdAt ||
      left.title.localeCompare(right.title, "ja-JP")
    );
  });
}
