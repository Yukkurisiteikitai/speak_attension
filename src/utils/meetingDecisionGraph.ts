import type {
  ActionData,
  AnalyzedSegment,
  MeetingDecisionEdge,
  MeetingDecisionGraph,
  MeetingDecisionNode,
  MeetingNodeType,
  MeetingDecisionRelation,
  MeetingNodeState,
} from "../types/topic";

export type { MeetingDecisionGraph, MeetingDecisionNode, MeetingDecisionEdge } from "../types/topic";

const EVIDENCE_PATTERN = /(?:\d+(?:\.\d+)?%|\d+件|エラー率|エラー|壊れ|破損|確認され|発生して|増加して)/;
const PROBLEM_PATTERN = /(?:課題|問題|不足|できない|困って|障害|壊れ|破損)/;
const RISK_PATTERN = /(?:このまま|続けると|増える|リスク|危険|被害|損失)/;
const PROPOSAL_PATTERN = /(?:戻そう|戻ろう|しよう|しましょう|してはどう|提案します|ロールバック|停止|切り戻そう)/;
const DECISION_PATTERN = /(?:それでいこう|それで行こう|決め(?:ます|た)|決定(?:します|した)|実施(?:します|する)|進めます|します$)/;
const ACTION_PATTERN = /(?:今すぐ|直ちに|至急|ロールバック|戻す|停止する|対応する|実施する)/;
const QUESTION_PATTERN = /[?？]|(?:ですか|ますか|でしょうか)$|^(?:なぜ|どうして|どういう|何が|誰が)/;
const TENTATIVE_PATTERN = /(?:かもしれない|可能性|と思う|としたら|場合は)/;
const NEGATIVE_PATTERN = /(?:しない|しません|見送|取り消|撤回|未決定)/;
const BOUNDARY_PATTERN = /^(?:次に|次の議題|次の話題|話は変わ|話を変えると|切り替えて|別件|以上です|今日はここまで)|^(?:今日は|今回は).+について(?:決めます|検討します|話します)/;

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[。.!！?？]+$/g, "");
}

function makeNode(
  type: MeetingNodeType,
  segment: AnalyzedSegment,
  label: string,
  state: MeetingNodeState,
  action?: ActionData,
): MeetingDecisionNode {
  return {
    id: `${type}-${segment.id}`,
    type,
    label,
    state,
    provenance: { utteranceIds: [segment.id], createdBy: "human" },
    createdAt: segment.createdAt,
    action,
    speaker: segment.metadata?.speaker,
  };
}

function addNode(graph: MeetingDecisionGraph, node: MeetingDecisionNode): MeetingDecisionGraph {
  return graph.nodes.some((candidate) => candidate.id === node.id) ? graph : { ...graph, nodes: [...graph.nodes, node] };
}

function addEdge(
  graph: MeetingDecisionGraph,
  source: string,
  target: string,
  relation: MeetingDecisionRelation,
): MeetingDecisionGraph {
  if (graph.edges.some((edge) => edge.source === source && edge.target === target && edge.relation === relation)) return graph;
  const edge: MeetingDecisionEdge = { id: `${source}-${relation}-${target}`, source, target, relation };
  return { ...graph, edges: [...graph.edges, edge] };
}

function latestNode(graph: MeetingDecisionGraph, types: MeetingNodeType[]): MeetingDecisionNode | undefined {
  return [...graph.nodes].reverse().find((node) => types.includes(node.type));
}

function supportingNodes(graph: MeetingDecisionGraph): MeetingDecisionNode[] {
  return graph.nodes.filter((node) => ["problem", "risk", "reason", "evidence"].includes(node.type)).slice(-5);
}

function actionLabel(text: string, priorProposal?: MeetingDecisionNode): string {
  const version = text.match(/v?\d+(?:\.\d+){1,3}/i)?.[0];
  if (version && /(?:戻|ロールバック|切り戻)/.test(text)) return `${version.startsWith("v") ? version : `v${version}`}へロールバック`;
  if (/ロールバック/.test(text) && priorProposal?.label) return priorProposal.label;
  if (/ロールバック/.test(text)) return "ロールバック";
  if (/停止/.test(text)) return "稼働を停止する";
  return text.replace(/^(?:それでいこう|それで行こう)[。、\s]*/, "") || priorProposal?.label || text;
}

function whyForRisk(risk?: MeetingDecisionNode): string | undefined {
  if (!risk) return undefined;
  if (/壊れ|破損/.test(risk.label)) return "データ破損を止める";
  return risk.label;
}

function whyNowForRisk(risk?: MeetingDecisionNode): string | undefined {
  if (!risk) return undefined;
  if (/壊れ.*(?:増え|増加)|(?:増え|増加).*壊れ/.test(risk.label)) return "稼働を続けるほど破損が増える";
  return risk.label;
}

function answerMatchesQuestion(question: MeetingDecisionNode, text: string): boolean {
  if (QUESTION_PATTERN.test(text) || TENTATIVE_PATTERN.test(text) || NEGATIVE_PATTERN.test(text)) return false;
  if (/(?:誰|担当)/.test(question.label)) return /(?:担当は|担当します|が担当|がやります|私が)/.test(text);
  if (/(?:いつ|期限|いつまで)/.test(question.label)) return /(?:まで|期限は|締切は|明日|今日|今週|来週|\d+月\d+日)/.test(text);
  if (/(?:なぜ|理由|根拠)/.test(question.label)) return /(?:理由は|根拠は|なぜなら|ため|ので|から)/.test(text);
  if (/(?:どの案|決め|方針)/.test(question.label)) return /(?:決めます|決定します|方針は|で進めます|を採用します)/.test(text);
  return /(?:回答は|答えは|確認できた事実は)/.test(text);
}

export function selectUnresolvedQuestions(graph: MeetingDecisionGraph): MeetingDecisionNode[] {
  const answered = new Set(graph.edges.filter((edge) => edge.relation === "answers").map((edge) => edge.target));
  return graph.nodes.filter((node) => node.type === "question" && !answered.has(node.id));
}

export function createInitialMeetingDecisionGraph(): MeetingDecisionGraph {
  return { nodes: [], edges: [] };
}

// Rule-based and incremental by design: every source utterance is retained and
// later nodes only point to evidence already present in the state.
export function appendMeetingDecisionSegment(
  current: MeetingDecisionGraph,
  segment: AnalyzedSegment,
): MeetingDecisionGraph {
  const text = compact(segment.text);
  if (!text || current.nodes.some((node) => node.id === `utterance-${segment.id}`)) return current;

  const utterance = makeNode("utterance", segment, segment.text, "human_stated");
  let graph = addNode(current, utterance);
  // Explicit topic boundaries prevent unrelated earlier evidence being reused.
  let boundary = -1;
  current.nodes.forEach((node, index) => {
    if (node.type === "utterance" && BOUNDARY_PATTERN.test(node.label)) boundary = index;
  });
  const context = (): MeetingDecisionGraph => ({ ...graph, nodes: graph.nodes.slice(boundary + 1) });
  const attachSource = (node: MeetingDecisionNode) => {
    graph = addNode(graph, node);
    graph = addEdge(graph, node.id, utterance.id, "derived_from");
  };

  if (QUESTION_PATTERN.test(segment.text) || QUESTION_PATTERN.test(text)) {
    const question = makeNode("question", segment, text, "human_stated");
    attachSource(question);
    const problem = latestNode(context(), ["problem"]);
    if (problem) graph = addEdge(graph, question.id, problem.id, "motivates");
    return graph;
  }
  if (BOUNDARY_PATTERN.test(text)) return graph;

  // Only direct affirmative answers are linked. Other statements remain
  // independent evidence rather than being guessed as an answer.
  const unanswered = selectUnresolvedQuestions(context());
  const latestQuestion = unanswered[unanswered.length - 1];
  if (latestQuestion && answerMatchesQuestion(latestQuestion, text)) {
    graph = addEdge(graph, utterance.id, latestQuestion.id, "answers");
  }

  if (EVIDENCE_PATTERN.test(text)) {
    const evidence = makeNode("evidence", segment, text, "human_stated");
    attachSource(evidence);
  }

  const isTentative = TENTATIVE_PATTERN.test(text);
  if (PROBLEM_PATTERN.test(text)) {
    const problem = makeNode("problem", segment, text, isTentative ? "unconfirmed" : "human_stated");
    attachSource(problem);
    for (const evidence of context().nodes.filter((node) => node.type === "evidence").slice(-3)) {
      graph = addEdge(graph, problem.id, evidence.id, "supports");
    }
  }
  const causal = text.match(/^(.+?)(?:だから|なので|ため|ので|から)[、,\s]+(.+)$/);
  if (isTentative || causal || /(?:原因|理由|なぜなら)/.test(text)) {
    const reason = makeNode("reason", segment, causal?.[1] ?? text, isTentative ? "unconfirmed" : "human_stated");
    attachSource(reason);
    for (const evidence of context().nodes.filter((node) => node.type === "evidence").slice(-3)) {
      graph = addEdge(graph, reason.id, evidence.id, "supports");
    }
  }

  if (RISK_PATTERN.test(text)) {
    const risk = makeNode("risk", segment, causal?.[1] ?? text, isTentative ? "unconfirmed" : "human_stated");
    attachSource(risk);
    for (const evidence of context().nodes.filter((node) => node.type === "evidence").slice(-3)) {
      graph = addEdge(graph, risk.id, evidence.id, "supports");
    }
  }

  const actionText = causal?.[2] ?? text;
  const namedOptions = [...new Set(actionText.match(/[A-Za-zＡ-Ｚａ-ｚ0-9一二三]+案/g) ?? [])];
  const namedOption = namedOptions.length === 1 ? namedOptions[0] : undefined;
  const namedProposals = namedOption ? context().nodes.filter((node) => node.type === "proposal" && node.label.includes(namedOption)) : [];
  const priorProposal = namedProposals.length === 1 ? namedProposals[0] : latestNode(context(), ["proposal"]);
  const isDecision = DECISION_PATTERN.test(actionText) && !/提案します/.test(actionText) && !isTentative && !NEGATIVE_PATTERN.test(actionText);
  if (PROPOSAL_PATTERN.test(actionText) && !isDecision && !NEGATIVE_PATTERN.test(actionText)) {
    const proposal = makeNode("proposal", segment, actionLabel(actionText, priorProposal), "proposed");
    attachSource(proposal);
    const question = latestNode(context(), ["question"]);
    if (question) graph = addEdge(graph, proposal.id, question.id, "motivates");
    for (const support of supportingNodes(context())) graph = addEdge(graph, proposal.id, support.id, "motivates");
  }

  if (isDecision) {
    const refersToProposal = /^(?:それでいこう|それで行こう)/.test(actionText);
    const actionName = refersToProposal && !ACTION_PATTERN.test(actionText) ? priorProposal?.label ?? actionText : actionLabel(actionText, priorProposal);
    const decision = makeNode("decision", segment, actionName, "decided");
    attachSource(decision);
    if (priorProposal && (refersToProposal || actionName === priorProposal.label || namedProposals.length === 1)) graph = addEdge(graph, decision.id, priorProposal.id, "decided_from");
    for (const support of supportingNodes(context())) graph = addEdge(graph, decision.id, support.id, "motivates");

    if (!refersToProposal || ACTION_PATTERN.test(text) || priorProposal) {
      const risk = latestNode(context(), ["risk"]);
      const reason = latestNode(context(), ["reason"]);
      const confirmedRisk = risk?.state === "human_stated" ? risk : undefined;
      const confirmedReason = reason?.state === "human_stated" ? reason : undefined;
      const action = makeNode("action", segment, actionName, "decided", {
        what: actionName,
        why: confirmedReason?.label ?? whyForRisk(confirmedRisk),
        whyNow: confirmedRisk && /このまま|続けると|増える|至急|今すぐ/.test(confirmedRisk.label) ? whyNowForRisk(confirmedRisk) : undefined,
        owner: actionText.match(/(?:^|[、。\s])([^、。\s]+?)(?:さん)?が/)?.[1],
        deadline: /(?:今すぐ|直ちに|至急)/.test(text) ? "即時" : actionText.match(/(?:今日|明日|今週|来週|今月|\d+月\d+日|\d+時)(?:中|の\d+時)?まで/)?.[0],
        urgency: /(?:今すぐ|直ちに|至急)/.test(text) ? "critical" : risk ? "high" : "medium",
        status: "decided",
      });
      attachSource(action);
      graph = addEdge(graph, action.id, decision.id, "decided_from");
    }
  }

  return graph;
}

export function traceDecisionGraphBackwards(graph: MeetingDecisionGraph, startNodeId: string): MeetingDecisionNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue = [startNodeId];
  const result: MeetingDecisionNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    result.push(node);
    for (const edge of graph.edges.filter((candidate) => candidate.source === id)) queue.push(edge.target);
  }
  return result;
}

export function selectDecisionParents(graph: MeetingDecisionGraph, nodeId: string): MeetingDecisionNode[] {
  const targets = new Set(graph.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target));
  return graph.nodes.filter((node) => targets.has(node.id))
    .sort((a, b) => Number(a.type === "utterance") - Number(b.type === "utterance"));
}

export function selectCurrentActions(graph: MeetingDecisionGraph): MeetingDecisionNode[] {
  const urgency = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return graph.nodes
    .filter((node) => node.type === "action" && node.state === "decided" && node.action && (node.action.status === undefined || node.action.status === "decided" || node.action.status === "in_progress"))
    .sort((a, b) => (urgency[a.action?.urgency ?? "low"] - urgency[b.action?.urgency ?? "low"]) || b.createdAt - a.createdAt);
}

export type ActionUpdate = Pick<ActionData, "owner" | "deadline" | "urgency" | "status"> & { note: string };

// Explicit UI updates target an action by ID; no proximity inference is used.
export function updateMeetingAction(
  graph: MeetingDecisionGraph, actionId: string, patch: ActionUpdate,
  record: { id: string; createdAt: number },
): MeetingDecisionGraph {
  const target = graph.nodes.find((node) => node.id === actionId && node.type === "action" && node.action);
  if (!target?.action || !patch.note.trim() || graph.nodes.some((node) => node.id === record.id)) return graph;
  const { note, ...fields } = patch;
  const update: MeetingDecisionNode = {
    id: record.id, type: "outcome", label: note.trim(), state: "human_stated",
    provenance: { utteranceIds: [], createdBy: "human" }, createdAt: record.createdAt,
    speaker: "操作担当者",
    actionChange: { actionId, before: { ...target.action }, after: { ...target.action, ...fields } },
  };
  const next = { ...graph, nodes: [...graph.nodes.map((node) => node.id === actionId
    ? { ...node, action: { ...target.action!, ...fields } } : node), update] };
  return addEdge(next, update.id, actionId, "derived_from");
}
