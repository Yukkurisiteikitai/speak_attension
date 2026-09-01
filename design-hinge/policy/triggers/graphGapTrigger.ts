import { createId } from "../../ids";
import { findIsolatedNodes, findLowConfidenceEdges } from "../../graph/graphQuery";
import type { HingeGraph } from "../../graph/types";
import type { InterventionCandidate } from "../types";

// Pure over HingeGraph, no timer state — build/dogfood first among the
// trigger set. Two sub-checks, both feeding "因果確認質問":
// 1. Isolated nodes beyond the tolerated count (isolatedNodeThreshold lets a
//    node sit briefly disconnected while the conversation is still forming,
//    per deep_research.md's "偶発的な孤立を許容").
// 2. Edges whose confidence is BELOW causalConfidenceThreshold: these are
//    tentative auto-extracted causal guesses worth confirming with the user,
//    the opposite direction from how the same threshold is used in
//    contradictionTrigger.ts (see that file's comment).
export function detectGraphGapTrigger(
  graph: HingeGraph,
  isolatedNodeThreshold: number,
  causalConfidenceThreshold: number,
  now: number,
): InterventionCandidate[] {
  const candidates: InterventionCandidate[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const isolated = [...findIsolatedNodes(graph)].sort((a, b) => a.createdAtMs - b.createdAtMs);
  for (const node of isolated.slice(isolatedNodeThreshold)) {
    candidates.push({
      id: createId("cand"),
      triggerType: "graph_gap",
      createdAtMs: now,
      reasonCode: `isolated_node:${node.id}`,
      reasonSummary: `「${node.label}」はどの要素とも因果関係がありません。`,
      relatedNodeIds: [node.id],
      relatedEdgeIds: [],
      confidence: 0.6,
      form: "question",
    });
  }

  for (const edge of findLowConfidenceEdges(graph, causalConfidenceThreshold)) {
    const sourceLabel = nodeById.get(edge.source)?.label ?? edge.source;
    const targetLabel = nodeById.get(edge.target)?.label ?? edge.target;
    candidates.push({
      id: createId("cand"),
      triggerType: "graph_gap",
      createdAtMs: now,
      reasonCode: `low_confidence_edge:${edge.id}`,
      reasonSummary: `「${sourceLabel}」から「${targetLabel}」への因果関係の確信度が低いです。`,
      relatedNodeIds: [edge.source, edge.target],
      relatedEdgeIds: [edge.id],
      confidence: edge.confidence,
      form: "question",
    });
  }

  return candidates;
}
