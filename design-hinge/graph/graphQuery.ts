import type { HingeEdge, HingeGraph, HingeNode } from "./types";

export function getOutgoingEdges(graph: HingeGraph, nodeId: string): HingeEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function getIncomingEdges(graph: HingeGraph, nodeId: string): HingeEdge[] {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

// A node with no edges at all is isolated. deep_research.md's "孤立ノード" trigger
// concept only cares about total disconnection, not directionality.
export function findIsolatedNodes(graph: HingeGraph): HingeNode[] {
  return graph.nodes.filter(
    (node) => !graph.edges.some((edge) => edge.source === node.id || edge.target === node.id),
  );
}

export function findLowConfidenceEdges(graph: HingeGraph, threshold: number): HingeEdge[] {
  return graph.edges.filter((edge) => edge.confidence < threshold);
}

// Proxy for "対立の可視化" (Contradiction Trigger): two edges between the same
// node pair whose relations directly conflict, or an explicit `contradicts` edge.
const OPPOSING_RELATIONS: Array<[HingeEdge["relation"], HingeEdge["relation"]]> = [
  ["causes", "blocks"],
  ["enables", "blocks"],
];

function relationsOppose(a: HingeEdge["relation"], b: HingeEdge["relation"]): boolean {
  if (a === "contradicts" || b === "contradicts") return true;
  return OPPOSING_RELATIONS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

export function findContradictingEdgePairs(graph: HingeGraph): Array<{ a: HingeEdge; b: HingeEdge }> {
  const pairs: Array<{ a: HingeEdge; b: HingeEdge }> = [];
  for (let i = 0; i < graph.edges.length; i += 1) {
    for (let j = i + 1; j < graph.edges.length; j += 1) {
      const a = graph.edges[i];
      const b = graph.edges[j];
      const sameEndpoints =
        (a.source === b.source && a.target === b.target) || (a.source === b.target && a.target === b.source);
      if (sameEndpoints && relationsOppose(a.relation, b.relation)) {
        pairs.push({ a, b });
      }
    }
  }
  return pairs;
}

const DEFAULT_MAX_HOPS = 3;

// Cycle-safe BFS over both edge directions. The doc's own standard causal
// chain contains a cycle (C -> J -> E, F -> C), so a visited-set guard is
// load-bearing, not defensive boilerplate.
export function traverseNHops(graph: HingeGraph, startNodeId: string, maxHops: number = DEFAULT_MAX_HOPS): HingeGraph {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(startNodeId)) return { sessionId: graph.sessionId, nodes: [], edges: [] };

  const visitedNodeIds = new Set<string>([startNodeId]);
  const collectedEdges = new Set<string>();
  let frontier = [startNodeId];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of graph.edges) {
        if (edge.source === nodeId || edge.target === nodeId) {
          collectedEdges.add(edge.id);
          const neighborId = edge.source === nodeId ? edge.target : edge.source;
          if (!visitedNodeIds.has(neighborId)) {
            visitedNodeIds.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    sessionId: graph.sessionId,
    nodes: graph.nodes.filter((node) => visitedNodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => collectedEdges.has(edge.id)),
  };
}

// Longest path of edges whose testStatus is "supported" or "partially_supported",
// starting from fromNodeId. Cycle-safe via a per-path visited set (not a global
// one, since revisiting a node via a different acyclic path is legitimate).
export function findLongestSupportedPath(graph: HingeGraph, fromNodeId: string, maxHops: number = DEFAULT_MAX_HOPS): HingeNode[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const startNode = nodeById.get(fromNodeId);
  if (!startNode) return [];

  let best: HingeNode[] = [startNode];

  function walk(nodeId: string, visited: Set<string>, path: HingeNode[]) {
    if (path.length > best.length) best = path;
    if (path.length - 1 >= maxHops) return;

    for (const edge of graph.edges) {
      if (edge.source !== nodeId) continue;
      if (edge.testStatus !== "supported" && edge.testStatus !== "partially_supported") continue;
      if (visited.has(edge.target)) continue;
      const targetNode = nodeById.get(edge.target);
      if (!targetNode) continue;

      const nextVisited = new Set(visited);
      nextVisited.add(edge.target);
      walk(edge.target, nextVisited, [...path, targetNode]);
    }
  }

  walk(fromNodeId, new Set([fromNodeId]), [startNode]);
  return best;
}
