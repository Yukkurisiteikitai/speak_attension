import { useState } from "react";
import type { DecisionMaterial, MeetingDecisionNode } from "../types/topic";
import type { StructuralGap } from "../utils/meetingStateDashboard";
import type { CurrentDiscussionState } from "../utils/currentDiscussionState";
import { actionStatusLabels, meetingStateLabels, meetingTypeLabels } from "../utils/meetingState";
import { CurrentDiscussionCard } from "./CurrentDiscussionCard";
import { CollapsibleZeroState } from "./CollapsibleZeroState";

type Props = {
  currentDiscussionState: CurrentDiscussionState;
  confirmedDecisions: MeetingDecisionNode[];
  reasonsByDecisionId: Record<string, MeetingDecisionNode[]>;
  structuralGaps: StructuralGap[];
  unresolvedItems: MeetingDecisionNode[];
  systemSuggestedChecks: DecisionMaterial[];
  humanConfirmedChecks: DecisionMaterial[];
  nextActions: MeetingDecisionNode[];
  onExplore: (nodeId: string) => void;
  onOpenDecisionSupport: () => void;
  onStartReview: () => void;
  // Inline evidence: the currently selected node (from any onExplore click)
  // and its direct parents, shown on this same screen instead of navigating
  // to a separate map. Deeper, multi-hop exploration stays in the advanced
  // trace map, opened explicitly via onOpenTraceMap.
  selectedNode: MeetingDecisionNode | null;
  selectedNodeParents: MeetingDecisionNode[];
  onCloseSelection: () => void;
  onOpenTraceMap: () => void;
};

function translateMissingFields(fields: string[]): string {
  const fieldMap: Record<string, string> = {
    owner: "担当",
    deadline: "期限",
  };
  return fields.map((f) => fieldMap[f] || f).join("・");
}

const ZERO_STATE_KEYS = ["decisions", "gaps", "unresolved", "suggested", "actions"] as const;
type ZeroStateKey = (typeof ZERO_STATE_KEYS)[number];

export function MeetingStateDashboard(props: Props) {
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null);
  const [openZeroStates, setOpenZeroStates] = useState<Set<ZeroStateKey>>(new Set());
  const { onExplore, selectedNode, selectedNodeParents, onCloseSelection, onOpenTraceMap } = props;

  const toggleZeroState = (key: ZeroStateKey) => setOpenZeroStates((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const zeroCounts: Record<ZeroStateKey, number> = {
    decisions: props.confirmedDecisions.length,
    gaps: props.structuralGaps.length,
    unresolved: props.unresolvedItems.length,
    suggested: props.systemSuggestedChecks.length,
    actions: props.nextActions.length,
  };
  const hasCollapsedZeroState = ZERO_STATE_KEYS.some((key) => zeroCounts[key] === 0 && !openZeroStates.has(key));

  return (
    <section className="panel meeting-state-dashboard" aria-label="会議の状況">
      {/* 現在地: what the discussion is doing right now, distinct from the
          parts list below (ADR 0020). Replaces the old plain "現在の判断
          テーマ" header and the old NOW spotlight -- both are now unified
          into this one orientation card. */}
      <CurrentDiscussionCard state={props.currentDiscussionState} onExploreQuestion={onExplore} />

      {/* Inline evidence: appears in place, right where the user clicked
          "根拠を見る", instead of moving to a separate screen. */}
      {selectedNode ? (
        <div className="selected-evidence" aria-live="polite">
          <div className="section-head">
            <h3>
              {meetingTypeLabels[selectedNode.type]} ／{" "}
              <span className={`decision-state state-${selectedNode.state}`}>{meetingStateLabels[selectedNode.state]}</span>
            </h3>
            <button type="button" onClick={onCloseSelection}>閉じる</button>
          </div>
          <p className="selected-evidence-label">{selectedNode.label}</p>
          {selectedNode.type === "utterance" || selectedNode.type === "decision" || selectedNode.type === "outcome" ? (
            <p className="selected-evidence-meta">
              {new Date(selectedNode.createdAt).toLocaleString("ja-JP")} ／ {selectedNode.speaker ?? "発言者不明"}
            </p>
          ) : null}
          {selectedNode.actionChange ? (
            <p>
              操作担当者による更新: {actionStatusLabels[selectedNode.actionChange.before.status ?? "decided"]} →{" "}
              {actionStatusLabels[selectedNode.actionChange.after.status ?? "decided"]}
            </p>
          ) : null}
          {selectedNodeParents.length > 0 ? (
            <ul className="selected-evidence-parents">
              {selectedNodeParents.map((parent) => (
                <li key={parent.id}>
                  <button type="button" onClick={() => onExplore(parent.id)}>
                    {meetingTypeLabels[parent.type]}へ: {parent.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : selectedNode.type !== "utterance" ? (
            <p className="empty-text">根拠は未確認です。</p>
          ) : null}
          <button type="button" className="quiet-button" onClick={onOpenTraceMap}>
            関係を詳しく見る（根拠マップ）
          </button>
        </div>
      ) : null}

      {/* 今決まっていること */}
      <CollapsibleZeroState title="今決まっていること" count={props.confirmedDecisions.length} open={openZeroStates.has("decisions")} onToggle={() => toggleZeroState("decisions")}>
        {props.confirmedDecisions.length === 0 ? (
          <p className="empty-text">まだ決定はありません。</p>
        ) : (
          <div className="decision-cards">
            {props.confirmedDecisions.map((decision) => {
              const isExpanded = expandedDecisionId === decision.id;
              const reasons = props.reasonsByDecisionId[decision.id] ?? [];
              return (
                <article className="decision-card" key={decision.id}>
                  <h3>{decision.label}</h3>
                  {reasons.length > 0 ? (
                    <>
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedDecisionId(isExpanded ? null : decision.id)}
                      >
                        {isExpanded ? "閉じる" : "なぜ？"}
                      </button>
                      {isExpanded ? (
                        <ol className="decision-trace">
                          {reasons.map((reasonNode) => (
                            <li key={reasonNode.id} className={`trace-node type-${reasonNode.type}`}>
                              <span>{meetingTypeLabels[reasonNode.type]}</span>
                              <strong>{reasonNode.label}</strong>
                              <button type="button" onClick={() => props.onExplore(reasonNode.id)}>
                                根拠を見る
                              </button>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </>
                  ) : null}
                  <button type="button" onClick={() => props.onExplore(decision.id)}>
                    根拠を見る
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </CollapsibleZeroState>

      {/* 確認が必要 */}
      <div className="section-head">
        <h2>確認が必要</h2>
      </div>

      <div className="gap-section">
        <CollapsibleZeroState title="構造上の不足" count={props.structuralGaps.length} open={openZeroStates.has("gaps")} onToggle={() => toggleZeroState("gaps")}>
          <div className="gap-list is-structural">
            {props.structuralGaps.map((gap) => (
              <div className="gap-item" key={gap.actionId}>
                <p>
                  <strong>{gap.actionLabel}</strong>
                </p>
                <p className="gap-fields">不足: {translateMissingFields(gap.missing)}</p>
                <button onClick={() => props.onExplore(gap.actionId)}>根拠を見る</button>
              </div>
            ))}
            {props.structuralGaps.length === 0 ? <p className="empty-text">構造上の不足はありません。</p> : null}
          </div>
        </CollapsibleZeroState>
      </div>

      <div className="gap-section">
        <CollapsibleZeroState title="未確認・未解決" count={props.unresolvedItems.length} open={openZeroStates.has("unresolved")} onToggle={() => toggleZeroState("unresolved")}>
          <div className="gap-list is-unresolved">
            {props.unresolvedItems.map((node) => (
              <div className="gap-item" key={node.id}>
                <p>
                  <span>{meetingTypeLabels[node.type]}</span>
                  <strong>{node.label}</strong>
                </p>
                <button onClick={() => props.onExplore(node.id)}>根拠を見る</button>
              </div>
            ))}
            {props.unresolvedItems.length === 0 ? <p className="empty-text">未確認・未解決の項目はありません。</p> : null}
          </div>
        </CollapsibleZeroState>
      </div>

      {/* 追加で確認できること: decisionSupport.ts is rule/regex based, not an
          LLM call, so this must never be labeled "AI". */}
      <div className="gap-section">
        <CollapsibleZeroState title="追加で確認できること" count={props.systemSuggestedChecks.length} open={openZeroStates.has("suggested")} onToggle={() => toggleZeroState("suggested")}>
          <div className="gap-list is-system-suggested">
            {props.systemSuggestedChecks.map((material) => (
              <div className="gap-item" key={material.id}>
                <p>
                  <strong>{material.title}</strong>
                </p>
                {material.question ? <p className="material-question">{material.question}</p> : null}
              </div>
            ))}
            {props.systemSuggestedChecks.length === 0 ? <p className="empty-text">追加で確認できることはありません。</p> : null}
            {props.systemSuggestedChecks.length > 0 ? (
              <button type="button" onClick={props.onOpenDecisionSupport}>
                確認しますか？（判断材料パネルを開く）
              </button>
            ) : null}
          </div>
          {props.humanConfirmedChecks.length > 0 ? (
            <div className="gap-list is-human-confirmed">
              <h4>確認済みの判断材料</h4>
              {props.humanConfirmedChecks.map((material) => (
                <div className="gap-item" key={material.id}>
                  <p>
                    <strong>{material.title}</strong>
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </CollapsibleZeroState>
      </div>

      {/* 次にやること */}
      <CollapsibleZeroState title="次にやること" count={props.nextActions.length} open={openZeroStates.has("actions")} onToggle={() => toggleZeroState("actions")}>
        {props.nextActions.length === 0 ? (
          <p className="empty-text">決定済みのアクションはまだありません。</p>
        ) : (
          <>
            <ul className="next-actions-list">
              {props.nextActions.map((node) => (
                <li key={node.id}>
                  <span>
                    {node.action?.what ?? node.label} — {node.action?.owner ?? "未割当"} /{" "}
                    {node.action?.deadline ?? "期限未設定"}
                  </span>
                  <button type="button" onClick={() => props.onExplore(node.id)}>
                    詳細
                  </button>
                </li>
              ))}
            </ul>
            <p className="next-actions-note">詳細な更新は右側の「アクション一覧」で行えます。</p>
          </>
        )}
      </CollapsibleZeroState>

      {hasCollapsedZeroState ? (
        <button type="button" className="quiet-button" onClick={() => setOpenZeroStates(new Set(ZERO_STATE_KEYS))}>
          すべての状態を見る
        </button>
      ) : null}

      <button type="button" className="primary-button" onClick={props.onStartReview}>
        確認・改善を始める
      </button>
    </section>
  );
}
