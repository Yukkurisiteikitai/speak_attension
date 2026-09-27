import type { DecisionMaterial, MeetingDecisionGraph, MeetingDecisionNode } from "../types/topic";
import { selectCurrentActions, selectDecisionParents, selectUnresolvedQuestions } from "./meetingDecisionGraph";

export type StructuralGap = {
  id: string;
  actionId: string;
  actionLabel: string;
  missing: Array<"owner" | "deadline">;
};

// A single rule-picked candidate to look at next. `reason` explains why the
// rule picked it; it is not a claim that this is the most important item —
// callers must not render it as "must" or "urgent".
export type NowSpotlight =
  | { kind: "structural_gap"; gap: StructuralGap; reason: string }
  | { kind: "unresolved"; node: MeetingDecisionNode; reason: string }
  | { kind: "action"; node: MeetingDecisionNode; reason: string }
  | null;

export type MeetingStateDashboardViewModel = {
  currentTopicTitle: string | null;
  confirmedDecisions: MeetingDecisionNode[];
  reasonsByDecisionId: Record<string, MeetingDecisionNode[]>;
  structuralGaps: StructuralGap[];
  unresolvedItems: MeetingDecisionNode[];
  // Candidates surfaced by decisionSupport.ts. That engine is rule/regex based,
  // not an LLM call, so these must never be labeled "AI" in the UI or in this
  // model's naming — "system suggested", not "AI suggested".
  systemSuggestedChecks: DecisionMaterial[];
  humanConfirmedChecks: DecisionMaterial[];
  nextActions: MeetingDecisionNode[];
  now: NowSpotlight;
};

export function buildMeetingStateDashboard(
  graph: MeetingDecisionGraph,
  materials: DecisionMaterial[],
  currentTopicTitle: string | null,
): MeetingStateDashboardViewModel {
  // Rule 1: confirmedDecisions = nodes with type === "decision" && state === "decided"
  const confirmedDecisions = graph.nodes.filter((node) => node.type === "decision" && node.state === "decided");

  // Rule 2: reasonsByDecisionId = map each confirmed decision to its parents via selectDecisionParents
  const reasonsByDecisionId: Record<string, MeetingDecisionNode[]> = {};
  for (const decision of confirmedDecisions) {
    reasonsByDecisionId[decision.id] = selectDecisionParents(graph, decision.id);
  }

  // Rule 3: structuralGaps = committed/in-progress action nodes missing owner/deadline.
  // A "proposed" action is not yet adopted, so a missing owner/deadline there
  // is not a structural gap — it would just be premature. Mirrors the
  // committed/in_progress/undefined set that selectCurrentActions() treats as live.
  const structuralGaps: StructuralGap[] = [];
  for (const node of graph.nodes) {
    if (node.type === "action" && node.action) {
      const status = node.action.status;
      if (status === "done" || status === "cancelled" || status === "proposed") continue;

      const missing: Array<"owner" | "deadline"> = [];
      if (!node.action.owner) missing.push("owner");
      if (!node.action.deadline) missing.push("deadline");

      if (missing.length > 0) {
        structuralGaps.push({
          id: `${node.id}-gap`,
          actionId: node.id,
          actionLabel: node.action.what,
          missing,
        });
      }
    }
  }

  // Rule 4: unresolvedItems = union (deduplicated by node id) of:
  // - selectUnresolvedQuestions(graph)
  // - proposal nodes not targeted by "decided_from" edges
  // - nodes with state === "unconfirmed"
  const unresolvedSet = new Map<string, MeetingDecisionNode>();

  for (const node of selectUnresolvedQuestions(graph)) {
    unresolvedSet.set(node.id, node);
  }

  const adoptedProposals = new Set(graph.edges.filter((edge) => edge.relation === "decided_from").map((edge) => edge.target));
  for (const node of graph.nodes) {
    if (node.type === "proposal" && !adoptedProposals.has(node.id)) {
      unresolvedSet.set(node.id, node);
    }
  }

  for (const node of graph.nodes) {
    if (node.state === "unconfirmed") {
      unresolvedSet.set(node.id, node);
    }
  }

  const confirmedIds = new Set(confirmedDecisions.map((n) => n.id));
  const unresolvedItems: MeetingDecisionNode[] = [];
  for (const node of graph.nodes) {
    if (unresolvedSet.has(node.id) && !confirmedIds.has(node.id)) {
      unresolvedItems.push(node);
    }
  }

  // Rule 5 & 6: Filter materials by status. Naming avoids implying a
  // provenance (AI vs. rule) that decisionSupport.ts does not actually track.
  const systemSuggestedChecks = materials.filter((m) => m.status === "open" || m.status === "recheck");
  const humanConfirmedChecks = materials.filter((m) => m.status === "checked" || m.status === "decided" || m.status === "accepted");

  // Rule 7: nextActions = exactly selectCurrentActions(graph)
  const nextActions = selectCurrentActions(graph);

  // Rule 8: now = a single rule-picked candidate with a stated reason.
  // Priority order is a display convenience, not a determination of
  // importance: structural gap > unanswered question > next action.
  let now: NowSpotlight = null;

  if (structuralGaps.length > 0) {
    now = {
      kind: "structural_gap",
      gap: structuralGaps[0],
      reason: "担当・期限が未設定のまま進行中のアクションです。",
    };
  } else {
    const firstQuestion = unresolvedItems.find((node) => node.type === "question");
    if (firstQuestion) {
      now = {
        kind: "unresolved",
        node: firstQuestion,
        reason: "まだ回答が記録されていない質問です。",
      };
    } else if (nextActions.length > 0) {
      now = {
        kind: "action",
        node: nextActions[0],
        reason: "優先度・記録順に基づく次のアクション候補です。",
      };
    }
  }

  // Rule 9: currentTopicTitle = pass through unchanged
  return {
    currentTopicTitle,
    confirmedDecisions,
    reasonsByDecisionId,
    structuralGaps,
    unresolvedItems,
    systemSuggestedChecks,
    humanConfirmedChecks,
    nextActions,
    now,
  };
}
