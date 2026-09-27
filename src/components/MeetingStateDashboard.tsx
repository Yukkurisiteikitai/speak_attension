import { useState } from "react";
import type { DecisionMaterial, MeetingDecisionNode } from "../types/topic";
import type { NowSpotlight, StructuralGap } from "../utils/meetingStateDashboard";
import { actionStatusLabels, meetingStateLabels, meetingTypeLabels } from "../utils/meetingState";

type Props = {
  currentTopicTitle: string | null;
  confirmedDecisions: MeetingDecisionNode[];
  reasonsByDecisionId: Record<string, MeetingDecisionNode[]>;
  structuralGaps: StructuralGap[];
  unresolvedItems: MeetingDecisionNode[];
  systemSuggestedChecks: DecisionMaterial[];
  humanConfirmedChecks: DecisionMaterial[];
  nextActions: MeetingDecisionNode[];
  now: NowSpotlight;
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

export function MeetingStateDashboard(props: Props) {
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null);
  const { now, onExplore, selectedNode, selectedNodeParents, onCloseSelection, onOpenTraceMap } = props;

  return (
    <section className="panel meeting-state-dashboard" aria-label="会議の状況">
      {/* 1. Header: Current topic */}
      <div className="section-head">
        <h2>現在の判断テーマ</h2>
      </div>
      <p className="dashboard-topic">{props.currentTopicTitle ?? "議題はまだありません"}</p>

      {/* 2. NOW spotlight: a rule-picked candidate, not a determined priority */}
      <div className="section-head">
        <h2>次に確認できること</h2>
      </div>
      {now === null ? (
        <div className="now-spotlight is-empty">
          <p>現在、ルールが提示する確認候補はありません。</p>
        </div>
      ) : now.kind === "structural_gap" ? (
        <div className="now-spotlight is-structural-gap">
          <h3>構造上の不足</h3>
          <p>
            <strong>{now.gap.actionLabel}</strong>
          </p>
          <p className="now-spotlight-missing">
            不足: {translateMissingFields(now.gap.missing)}
          </p>
          <button onClick={() => onExplore(now.gap.actionId)}>根拠を見る</button>
        </div>
      ) : now.kind === "unresolved" ? (
        <div className="now-spotlight is-unresolved">
          <h3>未確認・未解決</h3>
          <p>
            <strong>{now.node.label}</strong>
          </p>
          <button onClick={() => onExplore(now.node.id)}>根拠を見る</button>
        </div>
      ) : (
        <div className="now-spotlight is-action">
          <h3>対応候補のアクション</h3>
          <p>
            <strong>{now.node.action?.what ?? now.node.label}</strong>
          </p>
          <button onClick={() => onExplore(now.node.id)}>根拠を見る</button>
        </div>
      )}
      <p className="now-spotlight-caption">
        {now ? `理由: ${now.reason}　` : ""}
        ルールが選んだ一例です。重要度を確定するものではありません。会話の内容を優先してください。
      </p>

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

      {/* 3. Confirmed decisions */}
      <div className="section-head">
        <h2>今決まっていること</h2>
        <span>{props.confirmedDecisions.length}件</span>
      </div>
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
                            <button
                              type="button"
                              onClick={() => props.onExplore(reasonNode.id)}
                            >
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

      {/* 4. Confirmation needed */}
      <div className="section-head">
        <h2>確認が必要</h2>
      </div>

      {/* 4a. Structural gaps */}
      <div className="gap-section">
        <h3>構造上の不足</h3>
        {props.structuralGaps.length === 0 ? (
          <p className="empty-text">構造上の不足はありません。</p>
        ) : (
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
          </div>
        )}
      </div>

      {/* 4b. Unresolved items */}
      <div className="gap-section">
        <h3>未確認・未解決</h3>
        {props.unresolvedItems.length === 0 ? (
          <p className="empty-text">未確認・未解決の項目はありません。</p>
        ) : (
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
          </div>
        )}
      </div>

      {/* 4c. System-suggested checks. decisionSupport.ts is rule/regex based,
          not an LLM call, so this must never be labeled "AI". */}
      <div className="gap-section">
        <h3>追加で確認できること</h3>
        {props.systemSuggestedChecks.length === 0 && props.humanConfirmedChecks.length === 0 ? (
          <p className="empty-text">追加で確認できることはありません。</p>
        ) : (
          <>
            <div className="gap-list is-system-suggested">
              {props.systemSuggestedChecks.length === 0 ? (
                <p className="empty-text">追加で確認できることはありません。</p>
              ) : (
                props.systemSuggestedChecks.map((material) => (
                  <div className="gap-item" key={material.id}>
                    <p>
                      <strong>{material.title}</strong>
                    </p>
                    {material.question ? <p className="material-question">{material.question}</p> : null}
                  </div>
                ))
              )}
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
          </>
        )}
      </div>

      {/* 5. Next actions */}
      <div className="section-head">
        <h2>次にやること</h2>
      </div>
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

      {/* 6. Footer */}
      <button type="button" className="primary-button" onClick={props.onStartReview}>
        確認・改善を始める
      </button>
    </section>
  );
}
