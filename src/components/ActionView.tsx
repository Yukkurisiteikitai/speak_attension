import { useMemo, useState } from "react";
import type { ActionData, MeetingDecisionGraph, MeetingDecisionNode } from "../types/topic";
import { type ActionUpdate, selectCurrentActions, selectDecisionParents } from "../utils/meetingDecisionGraph";

import { meetingTypeLabels as typeLabels, meetingStateLabels as stateLabels, actionStatusLabels as statusLabels, selectPendingMeetingNodes } from "../utils/meetingState";

type ActionViewProps = {
  onExplore?: (id: string) => void;
  graph: MeetingDecisionGraph;
  onUpdate: (id: string, patch: ActionUpdate) => void;
};

function urgencyLabel(urgency: ActionData["urgency"]): string {
  return urgency === "critical" ? "最優先" : urgency === "high" ? "高" : urgency === "medium" ? "中" : "低";
}

function ReasonStep({ graph, node, path = [] }: { graph: MeetingDecisionGraph; node: MeetingDecisionNode; path?: string[] }) {
  const [open, setOpen] = useState(false);
  const parents = selectDecisionParents(graph, node.id).filter((parent) => ![...path, node.id].includes(parent.id));
  return (
    <li className={`trace-node type-${node.type}`}>
      <span>{typeLabels[node.type]} / {stateLabels[node.state]}</span>
      <strong>{node.label}</strong>
      {node.type === "utterance" || node.type === "decision" || node.type === "outcome" ? (
        <span>{new Date(node.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} / {node.speaker ?? "発言者不明"}</span>
      ) : null}
      {parents.length ? (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "閉じる" : "なぜ？ 元の根拠をたどる"}</button>
          {open ? <ol className="decision-trace">{parents.map((parent) => <ReasonStep key={parent.id} graph={graph} node={parent} path={[...path, node.id]} />)}</ol> : null}
        </>
      ) : node.type !== "utterance" ? <span>根拠は未確認です</span> : null}
    </li>
  );
}

export function ActionView({ graph, onUpdate, onExplore }: ActionViewProps) {
  const actions = useMemo(() => selectCurrentActions(graph), [graph]);
  const pending = useMemo(() => selectPendingMeetingNodes(graph), [graph]);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const expandedTrace = useMemo(
    () => (expandedActionId ? selectDecisionParents(graph, expandedActionId) : []),
    [expandedActionId, graph],
  );

  return (
    <section className="panel action-view" aria-label="アクション一覧">
      <div className="section-head">
        <h2>アクション一覧</h2>
        <span>{actions.length}件</span>
      </div>
      {actions.length ? (
        <div className="action-list">
          {actions.map((node) => {
            const action = node.action!;
            const expanded = expandedActionId === node.id;
            return (
              <article className={`action-card urgency-${action.urgency ?? "low"}`} key={node.id}>
                <div className="action-card-head">
                  <strong>{action.what}</strong>
                  <span>{urgencyLabel(action.urgency)}</span>
                </div>
                <dl>
                  <div>
                    <dt>理由</dt>
                    <dd>{action.why ?? "根拠を確認中"}</dd>
                  </div>
                  <div>
                    <dt>今やる理由</dt>
                    <dd>{action.whyNow ?? "緊急性の根拠は未確認"}</dd>
                  </div>
                  <div>
                    <dt>担当 / 期限</dt>
                    <dd>{action.owner ?? "未割当"} / {action.deadline ?? "未設定"}</dd>
                  </div>
                </dl>
                <div className="action-card-footer">
                  <span className={`decision-state state-${node.state}`}>{stateLabels[node.state]}</span>
                  <button type="button" aria-expanded={expanded} onClick={() => setExpandedActionId(expanded ? null : node.id)}>
                    {expanded ? "根拠を閉じる" : "なぜ？ 根拠を見る"}
                  </button>
                </div>
                {onExplore ? <button type="button" onClick={() => onExplore(node.id)}>中央のマップで根拠をたどる</button> : null}
                <ActionEditor key={JSON.stringify(action)} node={node} onUpdate={onUpdate} />
                {expanded ? (
                  <ol className="decision-trace" aria-label={`${action.what}の根拠経路`}>
                    {expandedTrace.map((traceNode) => (
                      <ReasonStep key={traceNode.id} graph={graph} node={traceNode} path={[node.id]} />
                    ))}
                  </ol>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-text">決定済みのアクションはまだありません。発言から提案・決定・根拠を記録します。</p>
      )}
      <details>
        <summary>完了・撤回したアクション</summary>
        {graph.nodes.filter((node) => node.type === "action" && (node.action?.status === "done" || node.action?.status === "cancelled")).map((node) => <article className="action-card" key={node.id}><strong>{node.label}</strong><ActionEditor key={JSON.stringify(node.action)} node={node} onUpdate={onUpdate} />{onExplore ? <button type="button" onClick={() => onExplore(node.id)}>根拠をたどる</button> : null}</article>)}
      </details>
      <details>
        <summary>結果・更新履歴</summary>
        <ol className="decision-trace">{graph.nodes.filter((node) => node.type === "outcome").map((node) => <ReasonStep key={node.id} graph={graph} node={node} />)}</ol>
      </details>
      {pending.length ? (
        <details>
          <summary>未決定・確認が必要な項目（{pending.length}件）</summary>
          <ol className="decision-trace">{pending.map((node) => <li key={node.id}><ol><ReasonStep graph={graph} node={node} /></ol>{node.action ? <ActionEditor key={JSON.stringify(node.action)} node={node} onUpdate={onUpdate} /> : null}</li>)}</ol>
        </details>
      ) : null}
    </section>
  );
}


function ActionEditor({ node, onUpdate }: { node: MeetingDecisionNode; onUpdate: ActionViewProps["onUpdate"] }) {
  const action = node.action!;
  const [owner, setOwner] = useState(action.owner ?? "");
  const [deadline, setDeadline] = useState(action.deadline ?? "");
  const [status, setStatus] = useState(action.status ?? "decided");
  const [urgency, setUrgency] = useState(action.urgency ?? "medium");
  const [note, setNote] = useState("");
  return <details>
    <summary>状態を更新（{statusLabels[action.status ?? "decided"]}）</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!note.trim()) return;
      onUpdate(node.id, { owner: owner.trim() || undefined, deadline: deadline.trim() || undefined, status, urgency,
        note: `担当: ${owner.trim() || "未割当"} / 期限: ${deadline.trim() || "未設定"} / 状態: ${statusLabels[status]} / 優先度: ${urgencyLabel(urgency)}。${note.trim()}` });
    }}>
      <label>担当<input value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
      <label>期限<input value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
      <label>状態<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>優先度<select value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}>
        {(["low", "medium", "high", "critical"] as const).map((value) => <option key={value} value={value}>{urgencyLabel(value)}</option>)}
      </select></label>
      <label>結果・変更の根拠<textarea required value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button type="submit">記録する</button>
    </form>
  </details>;
}
