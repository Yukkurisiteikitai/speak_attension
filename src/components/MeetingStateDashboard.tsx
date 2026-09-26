import { useState } from "react";
import type { DecisionMaterial, MeetingDecisionNode } from "../types/topic";
import type { NowSpotlight, StructuralGap } from "../utils/meetingStateDashboard";
import { meetingTypeLabels } from "../utils/meetingState";

type Props = {
  currentTopicTitle: string | null;
  confirmedDecisions: MeetingDecisionNode[];
  reasonsByDecisionId: Record<string, MeetingDecisionNode[]>;
  structuralGaps: StructuralGap[];
  unresolvedItems: MeetingDecisionNode[];
  aiSuggestedChecks: DecisionMaterial[];
  humanConfirmedChecks: DecisionMaterial[];
  nextActions: MeetingDecisionNode[];
  now: NowSpotlight;
  onExplore: (nodeId: string) => void;
  onOpenDecisionSupport: () => void;
  onStartReview: () => void;
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
  const { now, onExplore } = props;

  return (
    <section className="panel meeting-state-dashboard" aria-label="会議の状況">
      {/* 1. Header: Current topic */}
      <div className="section-head">
        <h2>現在の判断テーマ</h2>
      </div>
      <p className="dashboard-topic">{props.currentTopicTitle ?? "議題はまだありません"}</p>

      {/* 2. NOW spotlight */}
      {now === null ? (
        <div className="now-spotlight is-empty">
          <p>今すぐ確認すべき項目はありません。</p>
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
          <h3>次にやること</h3>
          <p>
            <strong>{now.node.action?.what ?? now.node.label}</strong>
          </p>
          <button onClick={() => onExplore(now.node.id)}>根拠を見る</button>
        </div>
      )}
      <p className="now-spotlight-caption">
        ルールによる提案です。会話の内容を優先してください。
      </p>

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

      {/* 4c. AI suggested checks */}
      <div className="gap-section">
        <h3>AIの確認候補</h3>
        {props.aiSuggestedChecks.length === 0 && props.humanConfirmedChecks.length === 0 ? (
          <p className="empty-text">AIによる確認候補はありません。</p>
        ) : (
          <>
            <div className="gap-list is-ai-suggested">
              {props.aiSuggestedChecks.length === 0 ? (
                <p className="empty-text">AIによる確認候補はありません。</p>
              ) : (
                props.aiSuggestedChecks.map((material) => (
                  <div className="gap-item" key={material.id}>
                    <p>
                      <strong>{material.title}</strong>
                    </p>
                    {material.question ? <p className="material-question">{material.question}</p> : null}
                  </div>
                ))
              )}
              {props.aiSuggestedChecks.length > 0 ? (
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
          <p className="next-actions-note">詳細な更新は右側の「NOW / 今すること」で行えます。</p>
        </>
      )}

      {/* 6. Footer */}
      <button type="button" className="primary-button" onClick={props.onStartReview}>
        確認・改善を始める
      </button>
    </section>
  );
}
