import { useMemo, useState } from "react";
import type { ActionData, MeetingDecisionGraph, MeetingDecisionNode, MeetingNodeState } from "../types/topic";
import { selectCurrentActions, traceDecisionGraphBackwards } from "../utils/meetingDecisionGraph";

type ActionViewProps = {
  graph: MeetingDecisionGraph;
};

const stateLabels: Record<MeetingNodeState, string> = {
  human_stated: "参加者の発言",
  decided: "決定済み",
  proposed: "提案",
  ai_suggested: "AI提案",
  unconfirmed: "未確認",
};

const typeLabels: Record<MeetingDecisionNode["type"], string> = {
  utterance: "元の発言",
  question: "質問",
  evidence: "根拠",
  proposal: "提案",
  reason: "理由",
  concern: "懸念",
  risk: "リスク",
  decision: "決定",
  action: "アクション",
  outcome: "結果",
};

function urgencyLabel(urgency: ActionData["urgency"]): string {
  return urgency === "critical" ? "最優先" : urgency === "high" ? "高" : urgency === "medium" ? "中" : "低";
}

export function ActionView({ graph }: ActionViewProps) {
  const actions = useMemo(() => selectCurrentActions(graph), [graph]);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const expandedTrace = useMemo(
    () => (expandedActionId ? traceDecisionGraphBackwards(graph, expandedActionId) : []),
    [expandedActionId, graph],
  );

  return (
    <section className="panel action-view" aria-label="今すること">
      <div className="section-head">
        <h2>NOW / 今すること</h2>
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
                  <button type="button" onClick={() => setExpandedActionId(expanded ? null : node.id)}>
                    {expanded ? "根拠を閉じる" : "なぜ？ 根拠を見る"}
                  </button>
                </div>
                {expanded ? (
                  <ol className="decision-trace" aria-label={`${action.what}の根拠経路`}>
                    {expandedTrace.map((traceNode) => (
                      <li key={traceNode.id} className={`trace-node type-${traceNode.type}`}>
                        <span>{typeLabels[traceNode.type]} / {stateLabels[traceNode.state]}</span>
                        <strong>{traceNode.label}</strong>
                      </li>
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
    </section>
  );
}
