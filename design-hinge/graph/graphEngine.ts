import { createId } from "../ids";
import type { HingeEdge, HingeGraph, HingeNode, NewHingeEdgeInput, NewHingeNodeInput } from "./types";

export function createInitialHingeGraph(sessionId: string): HingeGraph {
  return { sessionId, nodes: [], edges: [] };
}

export function addNode(
  graph: HingeGraph,
  input: NewHingeNodeInput,
  now: number = Date.now(),
): { graph: HingeGraph; node: HingeNode } {
  const node: HingeNode = {
    id: createId("node"),
    sessionId: graph.sessionId,
    type: input.type,
    label: input.label,
    content: input.content,
    origin: input.origin,
    confidence: input.confidence,
    createdAtMs: now,
    sourceSegmentId: input.sourceSegmentId,
    policyVersion: input.policyVersion,
  };
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, node };
}

export function addEdge(
  graph: HingeGraph,
  input: NewHingeEdgeInput,
  now: number = Date.now(),
): { graph: HingeGraph; edge: HingeEdge } {
  const hasSource = graph.nodes.some((node) => node.id === input.source);
  const hasTarget = graph.nodes.some((node) => node.id === input.target);
  if (!hasSource || !hasTarget) {
    throw new Error(`addEdge: source/target node not found (source=${input.source}, target=${input.target})`);
  }

  const edge: HingeEdge = {
    id: createId("edge"),
    source: input.source,
    target: input.target,
    relation: input.relation,
    confidence: input.confidence,
    evidenceType: input.evidenceType,
    provenance: input.provenance,
    testStatus: input.testStatus,
    scope: input.scope,
    counterfactual: input.counterfactual ?? false,
    createdAtMs: now,
  };
  return { graph: { ...graph, edges: [...graph.edges, edge] }, edge };
}

export function updateEdgeTestStatus(graph: HingeGraph, edgeId: string, status: HingeEdge["testStatus"]): HingeGraph {
  return {
    ...graph,
    edges: graph.edges.map((edge) => (edge.id === edgeId ? { ...edge, testStatus: status } : edge)),
  };
}

export function updateEdgeConfidence(graph: HingeGraph, edgeId: string, confidence: number): HingeGraph {
  return {
    ...graph,
    edges: graph.edges.map((edge) => (edge.id === edgeId ? { ...edge, confidence } : edge)),
  };
}

export function removeNode(graph: HingeGraph, nodeId: string): HingeGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

export function removeEdge(graph: HingeGraph, edgeId: string): HingeGraph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}
