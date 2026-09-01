import { createId } from "../../ids";
import { findContradictingEdgePairs } from "../../graph/graphQuery";
import type { HingeGraph } from "../../graph/types";
import type { InterventionCandidate } from "../types";

// Pure over HingeGraph, no timer state — build/dogfood first alongside
// graphGapTrigger.ts. Only surfaces a contradiction when at least one of the
// two conflicting edges is confident enough to matter (>= causalConfidenceThreshold):
// this is the "不確かな自動断定を抑制" direction — suppress flagging a conflict
// between two throwaway low-confidence guesses, since that's noise, not a
// real design tension worth interrupting for. This is the opposite direction
// from graphGapTrigger.ts's low-confidence-edge check, which deliberately
// surfaces low-confidence edges to ask for confirmation.
export function detectContradictionTrigger(
  graph: HingeGraph,
  causalConfidenceThreshold: number,
  now: number,
): InterventionCandidate[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return findContradictingEdgePairs(graph)
    .filter(({ a, b }) => a.confidence >= causalConfidenceThreshold || b.confidence >= causalConfidenceThreshold)
    .map(({ a, b }) => {
      const sourceLabel = nodeById.get(a.source)?.label ?? a.source;
      const targetLabel = nodeById.get(a.target)?.label ?? a.target;
      return {
        id: createId("cand"),
        triggerType: "contradiction" as const,
        createdAtMs: now,
        reasonCode: `contradiction:${a.id}:${b.id}`,
        reasonSummary: `「${sourceLabel}」と「${targetLabel}」の関係について、矛盾する仮説があります。`,
        relatedNodeIds: [a.source, a.target],
        relatedEdgeIds: [a.id, b.id],
        confidence: Math.max(a.confidence, b.confidence),
        form: "question" as const,
      };
    });
}
