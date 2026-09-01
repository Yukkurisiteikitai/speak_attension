import { removeEdge, removeNode } from "./graphEngine";
import type { HingeEdge, HingeGraph } from "./types";

export type GraphDiffResult = {
  removedNodeId?: string;
  removedEdgeId?: string;
  affectedNodeIds: string[];
  brokenEdges: HingeEdge[];
  summary: string;
};

function findRootNodeIds(graph: HingeGraph): string[] {
  return graph.nodes.filter((node) => !graph.edges.some((edge) => edge.target === node.id)).map((node) => node.id);
}

function forwardReachableSet(graph: HingeGraph, rootIds: string[]): Set<string> {
  const reachable = new Set<string>(rootIds);
  let frontier = [...rootIds];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of graph.edges) {
        if (edge.source === nodeId && !reachable.has(edge.target)) {
          reachable.add(edge.target);
          next.push(edge.target);
        }
      }
    }
    frontier = next;
  }
  return reachable;
}

function labelsOf(graph: HingeGraph, nodeIds: string[]): string[] {
  const idSet = new Set(nodeIds);
  return graph.nodes.filter((node) => idSet.has(node.id)).map((node) => node.label);
}

// Operationalizes the `counterfactual` edge attribute's definition
// (deep_research.md: "当該要素を戻したとき予測が消えるか") and the
// "反実仮想を一変数ずつ作る機能" MVP requirement: revert exactly one
// node/edge, diff which downstream nodes stop being reachable from any root
// (a root = a node with no incoming edges, i.e. an unconditioned rule/premise).
export function computeCounterfactualNodeRemoval(graph: HingeGraph, nodeId: string): GraphDiffResult {
  const targetNode = graph.nodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return { removedNodeId: nodeId, affectedNodeIds: [], brokenEdges: [], summary: `ノード「${nodeId}」は見つかりませんでした。` };
  }

  const rootIds = findRootNodeIds(graph);
  const originalReachable = forwardReachableSet(graph, rootIds);

  const modifiedGraph = removeNode(graph, nodeId);
  const modifiedRootIds = rootIds.filter((id) => id !== nodeId);
  const modifiedReachable = forwardReachableSet(modifiedGraph, modifiedRootIds);

  const affectedNodeIds = graph.nodes
    .map((node) => node.id)
    .filter((id) => id !== nodeId && originalReachable.has(id) && !modifiedReachable.has(id));

  const brokenEdges = graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
  const affectedLabels = labelsOf(graph, affectedNodeIds);
  const summary =
    affectedLabels.length > 0
      ? `「${targetNode.label}」を取り除くと、「${affectedLabels.join("」「")}」への到達性が失われます。`
      : `「${targetNode.label}」を取り除いても、他のノードの到達性には影響しません。`;

  return { removedNodeId: nodeId, affectedNodeIds, brokenEdges, summary };
}

export function computeCounterfactualEdgeRemoval(graph: HingeGraph, edgeId: string): GraphDiffResult {
  const targetEdge = graph.edges.find((edge) => edge.id === edgeId);
  if (!targetEdge) {
    return { removedEdgeId: edgeId, affectedNodeIds: [], brokenEdges: [], summary: `エッジ「${edgeId}」は見つかりませんでした。` };
  }

  const rootIds = findRootNodeIds(graph);
  const originalReachable = forwardReachableSet(graph, rootIds);

  const modifiedGraph = removeEdge(graph, edgeId);
  const modifiedReachable = forwardReachableSet(modifiedGraph, rootIds);

  const affectedNodeIds = graph.nodes
    .map((node) => node.id)
    .filter((id) => originalReachable.has(id) && !modifiedReachable.has(id));

  const sourceLabel = graph.nodes.find((node) => node.id === targetEdge.source)?.label ?? targetEdge.source;
  const targetLabel = graph.nodes.find((node) => node.id === targetEdge.target)?.label ?? targetEdge.target;
  const affectedLabels = labelsOf(graph, affectedNodeIds);
  const summary =
    affectedLabels.length > 0
      ? `「${sourceLabel}」から「${targetLabel}」への関係を取り除くと、「${affectedLabels.join("」「")}」への到達性が失われます。`
      : `「${sourceLabel}」から「${targetLabel}」への関係を取り除いても、他のノードの到達性には影響しません。`;

  return { removedEdgeId: edgeId, affectedNodeIds, brokenEdges: [targetEdge], summary };
}

// Sets edge.counterfactual = true for every edge whose removal alone makes at
// least one node unreachable from any root — i.e. edges that are load-bearing
// for some downstream prediction. O(E^2) reachability recomputation, which is
// fine at solo-session scale (tens to low hundreds of nodes).
export function markCounterfactualSensitivity(graph: HingeGraph): HingeGraph {
  const sensitiveEdgeIds = new Set(
    graph.edges
      .filter((edge) => computeCounterfactualEdgeRemoval(graph, edge.id).affectedNodeIds.length > 0)
      .map((edge) => edge.id),
  );

  return {
    ...graph,
    edges: graph.edges.map((edge) => ({ ...edge, counterfactual: sensitiveEdgeIds.has(edge.id) })),
  };
}
