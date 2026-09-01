import { addEdge, addNode } from "./graphEngine";
import { extractEdgeCandidates } from "./edgeCandidateExtraction";
import { jaccardSimilarity } from "./textSimilarity";
import type { HingeEdge, HingeGraph, HingeNode } from "./types";

export type IngestionResult = {
  graph: HingeGraph;
  proposedNodes: HingeNode[];
  proposedEdges: HingeEdge[];
};

const DEFAULT_MATCH_THRESHOLD = 0.6;

function resolveNodeId(
  graph: HingeGraph,
  label: string,
  sourceSegmentId: string,
  policyVersion: string,
  matchThreshold: number,
  now: number,
): { graph: HingeGraph; nodeId: string; created: HingeNode | null } {
  let bestNode: HingeNode | null = null;
  let bestScore = 0;
  for (const node of graph.nodes) {
    const score = jaccardSimilarity(label, node.label);
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  if (bestNode && bestScore >= matchThreshold) {
    return { graph, nodeId: bestNode.id, created: null };
  }

  const { graph: nextGraph, node } = addNode(
    graph,
    {
      type: "custom",
      label,
      content: label,
      origin: "human",
      confidence: 1,
      sourceSegmentId,
      policyVersion,
    },
    now,
  );
  return { graph: nextGraph, nodeId: node.id, created: node };
}

function edgeAlreadyExists(
  graph: HingeGraph,
  sourceId: string,
  targetId: string,
  relation: HingeEdge["relation"],
): boolean {
  return graph.edges.some(
    (edge) => edge.source === sourceId && edge.target === targetId && edge.relation === relation,
  );
}

// Orchestrator: plays the role src/utils/topicEngine.ts plays for the meeting
// engine — the single place to read to understand "what happens after one
// utterance arrives." Rule-based only (extractEdgeCandidates + jaccardSimilarity
// are both deterministic), per the hard constraint that real-time segment
// processing stays rule-based.
export function ingestUtteranceIntoGraph(
  graph: HingeGraph,
  text: string,
  sourceSegmentId: string,
  policyVersion: string,
  now: number = Date.now(),
  matchThreshold: number = DEFAULT_MATCH_THRESHOLD,
): IngestionResult {
  let workingGraph = graph;
  const proposedNodes: HingeNode[] = [];
  const proposedEdges: HingeEdge[] = [];

  for (const candidate of extractEdgeCandidates(text)) {
    const sourceResolved = resolveNodeId(
      workingGraph, candidate.sourceLabel, sourceSegmentId, policyVersion, matchThreshold, now,
    );
    workingGraph = sourceResolved.graph;
    if (sourceResolved.created) proposedNodes.push(sourceResolved.created);

    const targetResolved = resolveNodeId(
      workingGraph, candidate.targetLabel, sourceSegmentId, policyVersion, matchThreshold, now,
    );
    workingGraph = targetResolved.graph;
    if (targetResolved.created) proposedNodes.push(targetResolved.created);

    if (sourceResolved.nodeId === targetResolved.nodeId) continue;
    if (edgeAlreadyExists(workingGraph, sourceResolved.nodeId, targetResolved.nodeId, candidate.relation)) continue;

    const { graph: nextGraph, edge } = addEdge(
      workingGraph,
      {
        source: sourceResolved.nodeId,
        target: targetResolved.nodeId,
        relation: candidate.relation,
        confidence: 0.6,
        evidenceType: "user_hypothesis",
        provenance: "human",
        testStatus: "untested",
        scope: "this_work_only",
      },
      now,
    );
    workingGraph = nextGraph;
    proposedEdges.push(edge);
  }

  return { graph: workingGraph, proposedNodes, proposedEdges };
}
