import type {
  CoverageUpdate,
  FocusRelation,
  GraphTopicNodeData,
  MeetingGraph,
  ResolvedReference,
  TopicCoverage,
  TopicCoverageKey,
  TopicDisplayState,
  TopicEdge,
  TopicEdgeType,
  TopicGap,
  TopicGapSeverity,
  TopicGapType,
  TopicGraphEdge,
  TopicGraphNode,
  TopicMatchCandidate,
  TopicNode,
  TopicPhraseCandidate,
  UtteranceIntent,
} from "../types/topic";

const ROOT_TOPIC_ID = "meeting-root";
const ROOT_TITLE = "Meeting";
const FILLER_PHRASES = new Set([
  "そうですね",
  "はい",
  "なるほど",
  "了解",
  "うん",
  "そうです",
  "ですね",
  "お願いします",
  "ありがとう",
]);
const PRONOUN_ONLY = /^(これ|それ|あれ|ここ|そこ|あそこ|この件|その件|あの件)$/;
const STOP_WORDS = new Set([
  "今日",
  "今回",
  "あと",
  "さっき",
  "話",
  "件",
  "ところ",
  "こと",
  "感じ",
  "ほう",
  "それ",
  "これ",
  "あれ",
  "そこ",
  "ここ",
  "みたい",
  "ですね",
  "です",
  "ます",
  "する",
  "したい",
  "した",
  "決める",
  "問題",
]);

const TOPIC_MARKER_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /(.{2,24}?)について/g, reason: "marker: について" },
  { regex: /(.{2,24}?)の件/g, reason: "marker: の件" },
  { regex: /(.{2,24}?)を決め(?:る|ます|たい)/g, reason: "marker: を決める" },
  { regex: /(.{2,24}?)が問題/g, reason: "marker: が問題" },
  { regex: /(.{2,24}?)した(?:い|くない|ほうがいい)/g, reason: "marker: したい" },
];

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

export function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase("ja-JP")
    .replace(/[「」『』（）()【】［］.,、。!?！？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export function createInitialMeetingGraph(title = "Untitled meeting"): MeetingGraph {
  return {
    meetingId: createId("meeting"),
    title,
    rootTopicId: ROOT_TOPIC_ID,
    nodes: [
      {
        id: ROOT_TOPIC_ID,
        title: ROOT_TITLE,
        aliases: [ROOT_TITLE],
        lifecycle: "discussed",
        displayStates: ["discussed"],
        coverage: createEmptyCoverage(),
        evidenceSegmentIds: [],
        mentionCount: 0,
        openQuestionCount: 0,
        firstSeenAt: 0,
        lastSeenAt: 0,
        lastActivatedAt: null,
        closedAt: null,
        lastActivatedSegmentIndex: -1,
      },
    ],
    edges: [],
    gaps: [],
    gapSummary: {
      gaps: [],
      updatedAt: null,
    },
  };
}

export function getRootTopicId(): string {
  return ROOT_TOPIC_ID;
}

export function splitIntoClauses(text: string): string[] {
  return text
    .split(/[。.!！?？\n]/)
    .flatMap((chunk) => chunk.split(/(?:けど|ですが|ただ|それで|あとで|あと|なので|だから)/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokenize(text: string): string[] {
  const normalized = normalizeForMatch(text).replace(/(について|の件|って|で|が|は|を|に|と|も|から|まで|です|ます|する|したい|した|問題|理由)/g, " ");
  const matches = normalized.match(/[a-z0-9]+|[一-龠ぁ-んァ-ヶー]{2,}/g) ?? [];
  return matches.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function makeAliasPhrases(clause: string): string[] {
  const tokens = tokenize(clause);
  const aliases = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    aliases.add(tokens[index]);
    if (tokens[index + 1]) aliases.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return [...aliases].filter((alias) => alias.length >= 2).slice(0, 4);
}

function cleanupPhrase(value: string): string {
  return value
    .replace(/^(今日は|今回|では|その|この|あの|次に|まず|あとで|あと)\s*/g, "")
    .replace(/(について|の件|って|では|です|ます|の|が|を|は)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFillerUtterance(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact.length <= 8 && FILLER_PHRASES.has(compact);
}

export function extractTopicPhrases(text: string): TopicPhraseCandidate[] {
  if (isFillerUtterance(text)) return [];
  const phrases: TopicPhraseCandidate[] = [];

  for (const clause of splitIntoClauses(text)) {
    for (const pattern of TOPIC_MARKER_PATTERNS) {
      for (const match of clause.matchAll(pattern.regex)) {
        const phrase = cleanupPhrase(match[1] ?? "");
        if (!phrase || phrase.length < 2 || PRONOUN_ONLY.test(phrase) || isFillerUtterance(phrase)) continue;
        phrases.push({ phrase, clause, reason: pattern.reason });
      }
    }

    if (phrases.some((item) => item.clause === clause)) continue;

    const aliases = makeAliasPhrases(clause);
    const best = aliases.find((item) => !PRONOUN_ONLY.test(item));
    if (best && !isFillerUtterance(best)) {
      phrases.push({ phrase: cleanupPhrase(best), clause, reason: "fallback: content phrase" });
    }
  }

  return phrases.filter((item, index, all) => all.findIndex((candidate) => candidate.phrase === item.phrase) === index);
}

function overlapScore(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token));
  return overlap.length / Math.max(leftTokens.length, rightTokens.length);
}

export function scoreTopicMatch(phrase: string, node: TopicNode): TopicMatchCandidate {
  const aliases = [node.title, ...node.aliases];
  const scores = aliases.map((alias) => overlapScore(phrase, alias));
  const score = Math.max(...scores, 0);

  return {
    topicId: node.id,
    label: node.title,
    score: Number(score.toFixed(2)),
    reason: score > 0 ? `overlap with ${aliases[scores.indexOf(score)]}` : "no overlap",
  };
}

export function resolveTopicReference(text: string, activeTopicId: string | null): ResolvedReference[] {
  const phrases = ["その件", "この話", "さっきの話", "それで", "これ"];
  return phrases
    .filter((phrase) => text.includes(phrase))
    .map((phrase) => ({
      phrase,
      candidateTopicId: activeTopicId,
      confidence: activeTopicId ? 0.7 : 0.25,
      reason: activeTopicId ? "active topic reference" : "reference without active topic",
    }));
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

function nodePosition(index: number): { x: number; y: number } {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 180 + column * 300,
    y: 120 + row * 180,
  };
}

function gapPosition(index: number, parentY: number): { x: number; y: number } {
  return {
    x: 1040,
    y: parentY + index * 88,
  };
}

export function projectGraphToFlow(input: {
  graph: MeetingGraph;
  currentTopicId: string | null;
  evidenceByTopicId: Map<string, string>;
}): { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] } {
  const topicNodes = input.graph.nodes.filter((node) => node.id !== input.graph.rootTopicId);
  const nodeIndexMap = new Map<string, { x: number; y: number }>();

  const rootNode: TopicGraphNode = {
    id: input.graph.rootTopicId,
    type: "topic",
    position: { x: 520, y: 20 },
    data: {
      label: input.graph.title,
      kind: "root",
      states: ["discussed"],
      detail: "meeting root",
      isActive: false,
    } satisfies GraphTopicNodeData,
  };

  const flowNodes: TopicGraphNode[] = [rootNode];

  topicNodes.forEach((node, index) => {
    const position = nodePosition(index);
    nodeIndexMap.set(node.id, position);
    flowNodes.push({
      id: node.id,
      type: "topic",
      position,
      data: {
        label: node.title,
        kind: "topic",
        states: node.displayStates,
        lifecycle: node.lifecycle,
        mentionCount: node.mentionCount,
        evidence: input.evidenceByTopicId.get(node.id),
        isActive: node.id === input.currentTopicId,
      },
    });
  });

  const flowEdges: TopicGraphEdge[] = input.graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "default",
    data: {
      relation: edge.type,
    },
  }));

  const groupedGaps = new Map<string, TopicGap[]>();
  input.graph.gaps.forEach((gap) => {
    if (gap.closedAt) return;
    const items = groupedGaps.get(gap.topicId) ?? [];
    items.push(gap);
    groupedGaps.set(gap.topicId, items);
  });

  groupedGaps.forEach((gaps, topicId) => {
    const topicPosition = nodeIndexMap.get(topicId) ?? { x: 700, y: 200 };
    gaps.forEach((gap, index) => {
      flowNodes.push({
        id: gap.id,
        type: "topic",
        position: gapPosition(index, topicPosition.y - 24),
        data: {
          label: gap.title,
          kind: "gap",
          states: ["missing"],
          detail: gap.detail,
          isActive: false,
        },
      });
      flowEdges.push({
        id: `${gap.id}-edge`,
        source: topicId,
        target: gap.id,
        type: "default",
        data: {
          relation: "missing_of",
        },
      });
    });
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export function relationFromIntent(intent: UtteranceIntent, selectedTopicId: string | null, activeTopicId: string | null): FocusRelation {
  if (isNoiseIntent(intent) && !selectedTopicId) return "off_topic_noise";
  if (selectedTopicId && selectedTopicId === activeTopicId) return "on_focus";
  if (intent === "switch_topic" && selectedTopicId) return "on_focus";
  if (selectedTopicId) return "adjacent";
  if (intent === "question" || intent === "concern" || intent === "todo") return "off_topic_important";
  return "uncertain";
}

function isNoiseIntent(intent: UtteranceIntent): boolean {
  return intent === "agreement";
}

export function createTopicEdge(source: string, target: string, type: TopicEdgeType): TopicEdge {
  return {
    id: `${source}-${type}-${target}`,
    source,
    target,
    type,
  };
}
