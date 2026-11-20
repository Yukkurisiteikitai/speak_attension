// Phase 3 screen wiring: presents the canonical projection in the shape the
// existing Meeting State dashboard reads (MeetingDecisionGraph).
//
// Pure. It only renames and regroups what projectMeetingState already admitted.
// It never upgrades a state: a provisional entry stays "unconfirmed" (I6), and
// only a basis other than "provisional" can reach state "decided".
// Used only when SEMANTIC_CORE_FLAGS.meetingState is on.

import type { ActionData, MeetingDecisionGraph, MeetingDecisionNode, MeetingNodeType, MeetingNodeState } from "../types/topic";
import type { MeetingStateProjection } from "./meetingStateProjection";
import type { CanonicalEntry } from "./types";
import type { MeetingItem } from "./meetingItem";

// Buckets the dashboard displays. Topics, context, problems and options are
// not shown by the dashboard today, so they are left out of this graph rather
// than invented as nodes. They remain in the projection.
export function meetingStateGraphFromProjection(
  projection: MeetingStateProjection,
  createdAtOf: (utteranceId: string) => number,
): MeetingDecisionGraph {
  const nodes: MeetingDecisionNode[] = [
    ...projection.confirmedDecisions.map((entry) => toNode(entry, "decision", "decided", createdAtOf)),
    ...projection.provisionalDecisions.map((entry) => toNode(entry, "decision", "unconfirmed", createdAtOf)),
    ...projection.actions.map((entry) => actionNode(entry, createdAtOf)),
    ...projection.questions.map((entry) => toNode(entry, "question", "unconfirmed", createdAtOf)),
    ...projection.proposals.map((entry) => toNode(entry, "proposal", "proposed", createdAtOf)),
    ...projection.unresolved.map((entry) => toNode(entry, "concern", "unconfirmed", createdAtOf)),
    ...projection.deferred.map((entry) => toNode(entry, "concern", "unconfirmed", createdAtOf)),
  ];

  return { nodes, edges: [] };
}

// Review status lives in the meeting event log and is projected into minutes.
// Keep semantic provenance (for example, an explicit rule reading) intact, but
// do not let a reopened or held item appear settled in either dashboard graph.
export function applyReviewStateToMeetingGraph(
  graph: MeetingDecisionGraph,
  items: readonly MeetingItem[],
): MeetingDecisionGraph {
  const pending = items.filter((item) => item.reviewState === "pending" || item.reviewState === "held");
  if (pending.length === 0) return graph;
  const knownUtteranceIds = new Set(items.flatMap((item) => item.evidenceRefs.map((reference) => reference.utteranceId)));

  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "decision" && node.type !== "action") return node;
    const nodeLabel = normalizeEvidence(node.label);
    const hasSemanticSourceId = node.provenance.utteranceIds.some((id) => knownUtteranceIds.has(id));
    const needsReview = pending.some((item) => item.evidenceRefs.some((reference) => {
      const evidence = normalizeEvidence(reference.text);
      const sameSource = node.provenance.utteranceIds.includes(reference.utteranceId) ||
        (!hasSemanticSourceId && node.createdAt === reference.timestamp);
      return sameSource && evidence.length > 0 && (evidence.includes(nodeLabel) || nodeLabel.includes(evidence));
    }));
    if (!needsReview || (node.state === "unconfirmed" && node.action?.status === "proposed")) return node;
    changed = true;
    return {
      ...node,
      state: "unconfirmed" as const,
      ...(node.action ? { action: { ...node.action, status: "proposed" as const } } : {}),
    };
  });

  return changed ? { ...graph, nodes } : graph;
}

function normalizeEvidence(text: string): string {
  return text.replace(/[\s。、.!！?？]/g, "");
}

function toNode(
  entry: CanonicalEntry,
  type: MeetingNodeType,
  state: MeetingNodeState,
  createdAtOf: (utteranceId: string) => number,
): MeetingDecisionNode {
  return {
    id: entry.id,
    type,
    label: entry.label,
    state,
    provenance: provenanceOf(entry),
    createdAt: createdAtOf(entry.evidence.utteranceIds[0] ?? ""),
  };
}

function actionNode(entry: CanonicalEntry, createdAtOf: (utteranceId: string) => number): MeetingDecisionNode {
  const action: ActionData = {
    what: entry.label,
    owner: entry.owner ?? undefined,
    deadline: entry.deadline ?? undefined,
    status: entry.basis === "provisional" ? "proposed" : "decided",
  };
  return {
    ...toNode(entry, "action", entry.basis === "provisional" ? "unconfirmed" : "decided", createdAtOf),
    action,
  };
}

// The provenance type has only "human" and "ai". A rule reading is neither a
// person's statement nor an AI output, so it is labelled "ai" here and never
// "human" (the legacy graph did the latter; see design doc §1.2).
function provenanceOf(entry: CanonicalEntry): MeetingDecisionNode["provenance"] {
  return {
    utteranceIds: entry.evidence.utteranceIds,
    createdBy: entry.basis === "human_confirmed" ? "human" : "ai",
  };
}
