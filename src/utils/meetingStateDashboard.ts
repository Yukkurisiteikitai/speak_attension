import type { DecisionMaterial, MeetingDecisionGraph, MeetingDecisionNode } from "../types/topic";
import { selectCurrentActions, selectDecisionParents, selectUnresolvedQuestions } from "./meetingDecisionGraph";

export type StructuralGap = {
  id: string;
  actionId: string;
  actionLabel: string;
  missing: Array<"owner" | "deadline">;
};

export type NowSpotlight =
  | { kind: "structural_gap"; gap: StructuralGap }
  | { kind: "unresolved"; node: MeetingDecisionNode }
  | { kind: "action"; node: MeetingDecisionNode }
  | null;

export type MeetingStateDashboardViewModel = {
  currentTopicTitle: string | null;
  confirmedDecisions: MeetingDecisionNode[];
  reasonsByDecisionId: Record<string, MeetingDecisionNode[]>;
  structuralGaps: StructuralGap[];
  unresolvedItems: MeetingDecisionNode[];
  aiSuggestedChecks: DecisionMaterial[];
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

  // Rule 3: structuralGaps = check action nodes not done/cancelled for missing owner/deadline
  const structuralGaps: StructuralGap[] = [];
  for (const node of graph.nodes) {
    if (node.type === "action" && node.action) {
      const status = node.action.status;
      // Include if status is undefined, "proposed", "decided", or "in_progress" (exclude "done", "cancelled")
      if (status === "done" || status === "cancelled") continue;

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

  // Add unanswered questions
  for (const node of selectUnresolvedQuestions(graph)) {
    unresolvedSet.set(node.id, node);
  }

  // Add unadopted proposals
  const adoptedProposals = new Set(graph.edges.filter((edge) => edge.relation === "decided_from").map((edge) => edge.target));
  for (const node of graph.nodes) {
    if (node.type === "proposal" && !adoptedProposals.has(node.id)) {
      unresolvedSet.set(node.id, node);
    }
  }

  // Add unconfirmed nodes
  for (const node of graph.nodes) {
    if (node.state === "unconfirmed") {
      unresolvedSet.set(node.id, node);
    }
  }

  // Exclude nodes that are in confirmedDecisions
  const confirmedIds = new Set(confirmedDecisions.map((n) => n.id));
  const unresolvedItems: MeetingDecisionNode[] = [];
  for (const node of graph.nodes) {
    if (unresolvedSet.has(node.id) && !confirmedIds.has(node.id)) {
      unresolvedItems.push(node);
    }
  }

  // Rule 5 & 6: Filter materials by status
  const aiSuggestedChecks = materials.filter((m) => m.status === "open" || m.status === "recheck");
  const humanConfirmedChecks = materials.filter((m) => m.status === "checked" || m.status === "decided" || m.status === "accepted");

  // Rule 7: nextActions = exactly selectCurrentActions(graph)
  const nextActions = selectCurrentActions(graph);

  // Rule 8: now = priority-ordered spotlight
  let now: NowSpotlight = null;

  // Priority 1: If there are structural gaps, pick the first one
  if (structuralGaps.length > 0) {
    now = { kind: "structural_gap", gap: structuralGaps[0] };
  }
  // Priority 2: Else if there are unresolved items with type === "question", pick the first
  else if (unresolvedItems.some((node) => node.type === "question")) {
    const firstQuestion = unresolvedItems.find((node) => node.type === "question")!;
    now = { kind: "unresolved", node: firstQuestion };
  }
  // Priority 3: Else if there are next actions, pick the first (already sorted by urgency/createdAt)
  else if (nextActions.length > 0) {
    now = { kind: "action", node: nextActions[0] };
  }
  // Priority 4: Else null

  // Rule 9: currentTopicTitle = pass through unchanged
  return {
    currentTopicTitle,
    confirmedDecisions,
    reasonsByDecisionId,
    structuralGaps,
    unresolvedItems,
    aiSuggestedChecks,
    humanConfirmedChecks,
    nextActions,
    now,
  };
}
