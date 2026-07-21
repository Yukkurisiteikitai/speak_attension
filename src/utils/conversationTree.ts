import type {
  AnalyzedSegment,
  ConversationNodeRole,
  ConversationTreeNode,
  ConversationTreeState,
} from "../types/topic";
import { isFillerUtterance } from "./topicExtraction";

const TOPIC_PATTERN = /(?:今日は|今回|次に|では)?\s*(.{2,48}?)について(?:決めます|決める|話します|話す|検討します|検討する|相談します|相談する|確認します|確認する|議論します|議論する)/;
const TOPIC_SWITCH_PATTERN = /^(?:次に|別件|話を変えると|切り替えて)/;
const TOPIC_OPENING_PATTERN = /^今日は.{2,48}?(?:を決めたい|を決めます|を振り返ります|のレビューです|について)/;
const TOPIC_END_PATTERN = /^(?:(?:今日は)?(?:ここまで|以上)(?:です)?|以上で終わります)$/;
const ISSUE_PATTERN = /問題|課題|遅(?:い|さ)|困(?:る|って)|難しい|ボトルネック/;
const CAUSE_PATTERN = /理由|原因|背景|なぜなら|だから|ため(?:です|だ|に)?$/;
const ALTERNATIVE_PATTERN = /別案|他の案|代替|別の方法|別パターン/;
const ACTION_PATTERN = /(?:さん|氏|チーム|担当|私|自分)(?:が|は).*(?:まで|期限)|(?:まで|期限|締切).*(?:出します|出す|対応|確認|実施|進める)|(?:出します|対応します|確認します|実施します|進めます|やります)/;

export function createInitialConversationTreeState(): ConversationTreeState {
  return { nodes: [], activeTopicNodeId: null };
}

export function classifyConversationRole(text: string, hasTopic: boolean): ConversationNodeRole | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || isFillerUtterance(normalized)) return null;
  if (TOPIC_PATTERN.test(normalized) || TOPIC_SWITCH_PATTERN.test(normalized) || TOPIC_OPENING_PATTERN.test(normalized) || !hasTopic) return "topic";
  if (CAUSE_PATTERN.test(normalized)) return "cause";
  if (ALTERNATIVE_PATTERN.test(normalized)) return "alternative";
  if (ACTION_PATTERN.test(normalized)) return "action";
  if (ISSUE_PATTERN.test(normalized)) return "issue";
  return "statement";
}

export function conversationNodeLabel(text: string, role: ConversationNodeRole): string {
  const normalized = text.replace(/\s+/g, " ").trim().replace(/[。.!！?？]+$/g, "");
  if (role === "topic") {
    const match = normalized.match(TOPIC_PATTERN);
    if (match?.[1]) return match[1].replace(/^(?:今日は|今回|次に|では)\s*/, "").trim();
    return normalized
      .replace(/^(?:今日は|今回|次に|では)\s*/, "")
      .replace(/について(?:話します|相談します|確認します|議論します|検討します).*$/g, "")
      .replace(/を(?:決めたい|決めます|振り返ります).*$/g, "")
      .replace(/です$/g, "")
      .trim();
  }
  if (role === "cause") {
    return normalized
      .replace(/^(?:その)?理由(?:は|が)?\s*/, "")
      .replace(/^(?:原因|背景)(?:は|が)?\s*/, "")
      .replace(/(?:だから|ため)(?:です|だ)?$/g, "")
      .trim();
  }
  if (role === "alternative") return normalized.replace(/^(?:ただ|ただし|一方で)[、,\s]*/g, "").trim();
  return normalized.replace(/^(?:今日は|今回)\s*/, "").replace(/です$/g, "").trim();
}

function topicAncestorId(state: ConversationTreeState, node: ConversationTreeNode): string | null {
  let current: ConversationTreeNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.role === "topic") return current.id;
    seen.add(current.id);
    current = current.parentId ? state.nodes.find((candidate) => candidate.id === current?.parentId) : undefined;
  }
  return null;
}

function latestInActiveTopic(
  state: ConversationTreeState,
  roles: ConversationNodeRole[],
): ConversationTreeNode | undefined {
  return [...state.nodes]
    .reverse()
    .find((node) => roles.includes(node.role) && topicAncestorId(state, node) === state.activeTopicNodeId);
}

function parentForRole(state: ConversationTreeState, role: ConversationNodeRole): string | null {
  if (role === "topic") return null;
  if (role === "issue") return state.activeTopicNodeId;
  if (role === "cause") return latestInActiveTopic(state, ["issue"])?.id ?? state.activeTopicNodeId;
  return latestInActiveTopic(state, ["cause", "issue"])?.id ?? state.activeTopicNodeId;
}

export function appendConversationSegment(
  state: ConversationTreeState,
  segment: AnalyzedSegment,
): ConversationTreeState {
  if (state.nodes.some((node) => node.segmentId === segment.id)) return state;
  const compactText = segment.text.replace(/\s+/g, "").replace(/[。.!！?？]+$/g, "");
  if (TOPIC_END_PATTERN.test(compactText)) {
    return state.activeTopicNodeId ? { ...state, activeTopicNodeId: null } : state;
  }
  const role = classifyConversationRole(segment.text, Boolean(state.activeTopicNodeId));
  if (!role) return state;

  const node: ConversationTreeNode = {
    id: `conversation-${segment.id}`,
    segmentId: segment.id,
    parentId: parentForRole(state, role),
    role,
    label: conversationNodeLabel(segment.text, role),
    originalText: segment.text,
    createdAt: segment.createdAt,
    source: segment.source,
    rating: 0,
    manuallyAdjusted: false,
  };
  return {
    nodes: [...state.nodes, node],
    activeTopicNodeId: role === "topic" ? node.id : state.activeTopicNodeId,
  };
}

export function updateConversationNode(
  state: ConversationTreeState,
  nodeId: string,
  patch: { role?: ConversationNodeRole; parentId?: string | null },
): ConversationTreeState {
  const nodeIndex = state.nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) return state;
  if (patch.parentId === nodeId) return state;
  if (patch.parentId !== undefined && patch.parentId !== null) {
    const parentIndex = state.nodes.findIndex((node) => node.id === patch.parentId);
    if (parentIndex < 0 || parentIndex >= nodeIndex) return state;
  }
  return {
    ...state,
    nodes: state.nodes.map((node, index) =>
      index === nodeIndex
        ? {
            ...node,
            role: patch.role ?? node.role,
            parentId: patch.parentId === undefined ? node.parentId : patch.parentId,
            manuallyAdjusted: true,
          }
        : node,
    ),
  };
}

export function toggleConversationNodeRating(state: ConversationTreeState, nodeId: string): ConversationTreeState {
  if (!state.nodes.some((node) => node.id === nodeId)) return state;
  return {
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId ? { ...node, rating: node.rating === 1 ? 0 : 1 } : node,
    ),
  };
}
