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
const RISK_PATTERN = /(?:このまま|続けると|増える|リスク|危険|被害|損失)/;
const PROPOSAL_PATTERN = /(?:戻そう|戻ろう|ロールバック(?:しよう)?|停止(?:しよう)?|切り戻(?:そう|す))/;
const DECISION_PATTERN = /(?:それでいこう|それで行こう|決め(?:よう|ます|た)|方針(?:で|に)|実施(?:します|する)|進め(?:よう|ます))/;
const ACTION_PATTERN = /(?:今すぐ|直ちに|至急|ロールバック|戻す|停止する|対応する|実施する)/;

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
  return graph.nodes.filter((node) => ["risk", "reason", "evidence"].includes(node.type)).slice(-5);
}

function actionLabel(text: string, priorProposal?: MeetingDecisionNode): string {
  const version = text.match(/v?\d+(?:\.\d+){1,3}/i)?.[0];
  if (version && /(?:戻|ロールバック|切り戻)/.test(text)) return `${version.startsWith("v") ? version : `v${version}`}へロールバック`;
  if (/ロールバック/.test(text) && priorProposal?.label) return priorProposal.label;
  if (/ロールバック/.test(text)) return "ロールバック";
  if (/停止/.test(text)) return "稼働を停止する";
  return priorProposal?.label ?? text;
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

  const utterance = makeNode("utterance", segment, text, "human_stated");
  let graph = addNode(current, utterance);
  const attachSource = (node: MeetingDecisionNode) => {
    graph = addNode(graph, node);
    graph = addEdge(graph, node.id, utterance.id, "derived_from");
  };

  if (/[?？]/.test(text)) attachSource(makeNode("question", segment, text, "human_stated"));

  if (EVIDENCE_PATTERN.test(text)) {
    const evidence = makeNode("evidence", segment, text, "human_stated");
    attachSource(evidence);
  }

  const isTentative = /(?:かもしれない|可能性|と思う)/.test(text);
  if (isTentative || /(?:原因|理由|なぜなら)/.test(text)) {
    const reason = makeNode("reason", segment, text, isTentative ? "unconfirmed" : "human_stated");
    attachSource(reason);
    for (const evidence of graph.nodes.filter((node) => node.type === "evidence").slice(-3)) {
      graph = addEdge(graph, reason.id, evidence.id, "supports");
    }
  }

  if (RISK_PATTERN.test(text)) {
    const risk = makeNode("risk", segment, text, "human_stated");
    attachSource(risk);
    for (const evidence of graph.nodes.filter((node) => node.type === "evidence").slice(-3)) {
      graph = addEdge(graph, risk.id, evidence.id, "supports");
    }
  }

  const priorProposal = latestNode(graph, ["proposal"]);
  if (PROPOSAL_PATTERN.test(text) && !DECISION_PATTERN.test(text)) {
    const proposal = makeNode("proposal", segment, actionLabel(text, priorProposal), "proposed");
    attachSource(proposal);
    for (const support of supportingNodes(graph)) graph = addEdge(graph, proposal.id, support.id, "motivates");
  }

  if (DECISION_PATTERN.test(text)) {
    const actionName = ACTION_PATTERN.test(text) ? actionLabel(text, priorProposal) : priorProposal?.label ?? text;
    const decision = makeNode("decision", segment, `${actionName}を実施する`, "decided");
    attachSource(decision);
    if (priorProposal) graph = addEdge(graph, decision.id, priorProposal.id, "decided_from");
    for (const support of supportingNodes(graph)) graph = addEdge(graph, decision.id, support.id, "motivates");

    if (ACTION_PATTERN.test(text) || priorProposal) {
      const risk = latestNode(graph, ["risk"]);
      const action = makeNode("action", segment, actionName, "decided", {
        what: actionName,
        why: whyForRisk(risk),
        whyNow: whyNowForRisk(risk),
        deadline: /(?:今すぐ|直ちに|至急)/.test(text) ? "即時" : undefined,
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

export function selectCurrentActions(graph: MeetingDecisionGraph): MeetingDecisionNode[] {
  const urgency = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return graph.nodes
    .filter((node) => node.type === "action" && node.action?.status !== "done")
    .sort((a, b) => (urgency[a.action?.urgency ?? "low"] - urgency[b.action?.urgency ?? "low"]) || b.createdAt - a.createdAt);
}
