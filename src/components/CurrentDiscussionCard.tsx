import type { CurrentDiscussionState } from "../utils/currentDiscussionState";
import { discussionStageLabels } from "../utils/currentDiscussionState";

type CurrentDiscussionCardProps = {
  state: CurrentDiscussionState;
  onExploreQuestion: (nodeId: string) => void;
};

export function CurrentDiscussionCard({ state, onExploreQuestion }: CurrentDiscussionCardProps) {
  const sourceNoteText = {
    unresolved_question: "（未解決の問いから）",
    recent_utterance: "（直近の発言から）",
    unknown: "（論点は特定できていません）",
  };

  return (
    <section className="current-discussion-card" aria-label="現在地">
      {/* Topic block */}
      <div className="current-discussion-topic">
        <span className="eyebrow">現在の論点</span>
        <strong>{state.topicTitle ?? "論点を特定できません"}</strong>
        {state.topicTitleSource !== "extracted_topic" && (
          <small className="topic-source-note">{sourceNoteText[state.topicTitleSource]}</small>
        )}
      </div>

      {/* Stage block */}
      <div className="current-discussion-stage">
        <span className="eyebrow">現在地</span>
        <strong className={`stage-badge stage-${state.stage}`}>
          {discussionStageLabels[state.stage]}
        </strong>
        <small className="current-discussion-caption">
          会話の内容から機械的に分類した目安です。断定ではありません。
        </small>
      </div>

      {/* Unresolved question block (only if present) */}
      {state.unresolvedQuestion && (
        <div className="current-discussion-question">
          <span className="eyebrow">未解決の問い</span>
          <p>「{state.unresolvedQuestion.label}」</p>
          <button
            type="button"
            onClick={() => onExploreQuestion(state.unresolvedQuestion!.id)}
          >
            根拠を見る
          </button>
        </div>
      )}

      {/* Progress condition block (only if present) */}
      {state.progressCondition && (
        <div className="current-discussion-progress">
          <span className="eyebrow">次に前進する条件（推定）</span>
          <p>{state.progressCondition}</p>
        </div>
      )}

      {/* Decision theme block (always rendered) */}
      <div className="current-discussion-theme">
        <span className="eyebrow">判断テーマ</span>
        <strong>{state.decisionThemeTitle ?? "なし"}</strong>
      </div>
    </section>
  );
}
