import type {
  ConversationGraphEdge,
  ConversationGraphNode,
  ConversationGraphNodeData,
  ConversationTreeNode,
  ConversationTreeState,
} from "../types/topic";
import { estimateTextWidth } from "./textMetrics";

export const CONVERSATION_ROOT_ID = "conversation-root";
export const CONVERSATION_ROOT_WIDTH = 210;
export const CONVERSATION_NODE_WIDTH = 300;
const ROOT_HEIGHT = 76;
const MIN_NODE_HEIGHT = 82;
const NODE_TEXT_WIDTH = 258;
const LINE_HEIGHT = 20;
const COLUMN_GAP = 100;
const SIBLING_GAP = 22;

export function estimateConversationNodeHeight(data: ConversationGraphNodeData): number {
  if (data.role === "root") return ROOT_HEIGHT;
  const lines = Math.max(1, Math.ceil(estimateTextWidth(data.label, 14) / NODE_TEXT_WIDTH));
  return Math.max(MIN_NODE_HEIGHT, 56 + lines * LINE_HEIGHT);
}

type LayoutBranch = {
  node: ConversationTreeNode;
  children: LayoutBranch[];
  height: number;
};

function makeBranch(node: ConversationTreeNode, childrenByParent: Map<string | null, ConversationTreeNode[]>): LayoutBranch {
  const children = (childrenByParent.get(node.id) ?? []).map((child) => makeBranch(child, childrenByParent));
  const ownHeight = estimateConversationNodeHeight({ label: node.label, role: node.role, rating: node.rating });
  const childrenHeight = children.reduce(
    (sum, child, index) => sum + child.height + (index > 0 ? SIBLING_GAP : 0),
    0,
  );
  return { node, children, height: Math.max(ownHeight, childrenHeight) };
}

function xAtDepth(depth: number): number {
  if (depth === 0) return 0;
  if (depth === 1) return CONVERSATION_ROOT_WIDTH + COLUMN_GAP;
  return CONVERSATION_ROOT_WIDTH + COLUMN_GAP + (depth - 1) * (CONVERSATION_NODE_WIDTH + COLUMN_GAP);
}

export function projectConversationTreeToFlow(
  state: ConversationTreeState,
  rootLabel = "会議",
): { nodes: ConversationGraphNode[]; edges: ConversationGraphEdge[] } {
  const knownIds = new Set(state.nodes.map((node) => node.id));
  const childrenByParent = new Map<string | null, ConversationTreeNode[]>();
  for (const node of state.nodes) {
    const parentId = node.parentId && knownIds.has(node.parentId) ? node.parentId : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node]);
  }

  const roots = (childrenByParent.get(null) ?? []).map((node) => makeBranch(node, childrenByParent));
  const totalHeight = Math.max(
    ROOT_HEIGHT,
    roots.reduce((sum, branch, index) => sum + branch.height + (index > 0 ? SIBLING_GAP : 0), 0),
  );
  const nodes: ConversationGraphNode[] = [
    {
      id: CONVERSATION_ROOT_ID,
      type: "conversation",
      position: { x: 0, y: (totalHeight - ROOT_HEIGHT) / 2 },
      data: { label: rootLabel, role: "root", rating: 0 },
      draggable: false,
    },
  ];
  const edges: ConversationGraphEdge[] = [];

  function placeBranch(branch: LayoutBranch, depth: number, blockTop: number, parentId: string) {
    const data: ConversationGraphNodeData = {
      label: branch.node.label,
      role: branch.node.role,
      rating: branch.node.rating,
      originalText: branch.node.originalText,
    };
    const nodeHeight = estimateConversationNodeHeight(data);
    nodes.push({
      id: branch.node.id,
      type: "conversation",
      position: { x: xAtDepth(depth), y: blockTop + (branch.height - nodeHeight) / 2 },
      data,
      draggable: false,
    });
    edges.push({
      id: `conversation-edge-${parentId}-${branch.node.id}`,
      source: parentId,
      sourceHandle: "child",
      target: branch.node.id,
      targetHandle: "parent",
      type: "smoothstep",
      data: { relation: "conversation" },
    });

    const childrenHeight = branch.children.reduce(
      (sum, child, index) => sum + child.height + (index > 0 ? SIBLING_GAP : 0),
      0,
    );
    let childTop = blockTop + (branch.height - childrenHeight) / 2;
    for (const child of branch.children) {
      placeBranch(child, depth + 1, childTop, branch.node.id);
      childTop += child.height + SIBLING_GAP;
    }
  }

  let rootTop = (totalHeight - roots.reduce(
    (sum, branch, index) => sum + branch.height + (index > 0 ? SIBLING_GAP : 0),
    0,
  )) / 2;
  for (const branch of roots) {
    placeBranch(branch, 1, rootTop, CONVERSATION_ROOT_ID);
    rootTop += branch.height + SIBLING_GAP;
  }

  return { nodes, edges };
}
