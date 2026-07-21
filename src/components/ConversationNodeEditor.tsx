import type { ConversationNodeRole, ConversationTreeState } from "../types/topic";

const roleLabels: Record<ConversationNodeRole, string> = {
  topic: "話題",
  issue: "課題",
  cause: "原因",
  action: "アクション",
  alternative: "別案",
  statement: "発言",
};

type ConversationNodeEditorProps = {
  conversationTree: ConversationTreeState;
  selectedNodeId: string | null;
  onUpdate: (nodeId: string, patch: { role?: ConversationNodeRole; parentId?: string | null }) => void;
};

export function ConversationNodeEditor({ conversationTree, selectedNodeId, onUpdate }: ConversationNodeEditorProps) {
  if (!selectedNodeId) return null;
  const nodeIndex = conversationTree.nodes.findIndex((node) => node.id === selectedNodeId);
  const node = conversationTree.nodes[nodeIndex];
  if (!node) return null;
  const parentCandidates = conversationTree.nodes.slice(0, nodeIndex);

  return (
    <section className="panel conversation-node-editor" aria-label="会話ノードの修正">
      <div className="section-head">
        <h2>選択したノード</h2>
        <span>{node.manuallyAdjusted ? "手動修正済み" : "自動判定"}</span>
      </div>
      <p>{node.label}</p>
      <label>
        <span>役割</span>
        <select
          aria-label="選択ノードの役割"
          value={node.role}
          onChange={(event) => onUpdate(node.id, { role: event.currentTarget.value as ConversationNodeRole })}
        >
          {(Object.entries(roleLabels) as Array<[ConversationNodeRole, string]>).map(([value, label]) => (
            <option value={value} key={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>親</span>
        <select
          aria-label="選択ノードの親"
          value={node.parentId ?? ""}
          onChange={(event) => onUpdate(node.id, { parentId: event.currentTarget.value || null })}
        >
          <option value="">会議</option>
          {parentCandidates.map((candidate) => (
            <option value={candidate.id} key={candidate.id}>
              {roleLabels[candidate.role]}: {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <small>親は、この発言より前に追加されたノードから選べます。</small>
    </section>
  );
}
