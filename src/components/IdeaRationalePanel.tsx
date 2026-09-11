import { ChevronRight, FileText, Lightbulb } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IdeaSessionState } from "../utils/ideaSession";
import { ideaDecisionLabel, selectIdeaRationale } from "../utils/ideaRationale";

type Props = {
  session: IdeaSessionState;
  focusedKeywordId?: string | null;
  onFocusKeyword?: (keywordId: string) => void;
};

export function IdeaRationalePanel({ session, focusedKeywordId, onFocusKeyword }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latestKeywordId = session.keywords.at(-1)?.id ?? null;

  useEffect(() => {
    if (selectedId && session.keywords.some((keyword) => keyword.id === selectedId)) return;
    setSelectedId(latestKeywordId);
  }, [latestKeywordId, selectedId, session.keywords]);

  useEffect(() => {
    if (focusedKeywordId && session.keywords.some((keyword) => keyword.id === focusedKeywordId)) {
      setSelectedId(focusedKeywordId);
    }
  }, [focusedKeywordId, session.keywords]);

  const rationale = useMemo(
    () => (selectedId ? selectIdeaRationale(session, selectedId) : null),
    [selectedId, session],
  );

  return (
    <section className="idea-card idea-rationale-card" aria-label="アイデアの根拠と現在地">
      <h2>アイデアの根拠と現在地</h2>
      <p>収集した発言から、グループと採否まで確認できます。</p>
      {session.keywords.length === 0 ? (
        <div className="idea-rationale-empty"><Lightbulb size={18} />アイデアを追加すると、ここで出典を確認できます。</div>
      ) : (
        <>
          <div className="idea-rationale-choices" aria-label="確認するアイデア">
            {[...session.keywords].reverse().map((keyword) => (
              <button
                key={keyword.id}
                type="button"
                className={keyword.id === selectedId ? "is-selected" : ""}
                aria-pressed={keyword.id === selectedId}
                onClick={() => {
                  setSelectedId(keyword.id);
                  onFocusKeyword?.(keyword.id);
                }}
              >
                {keyword.label}<span>{keyword.mentionCount}回</span>
              </button>
            ))}
          </div>
          {rationale ? (
            <div className="idea-rationale-trace">
              <strong>{rationale.keyword.label}</strong>
              <ol>
                <li><ChevronRight size={14} />現在: {ideaDecisionLabel(rationale.keyword.decision)}</li>
                <li><ChevronRight size={14} />{rationale.groupTitle ? `グループ: ${rationale.groupTitle}` : "グループ化前"}</li>
                {rationale.utterances.map((utterance) => {
                  const meetingReference = utterance.sourceReferences?.[0];
                  return (
                    <li className="idea-rationale-source" key={utterance.id}>
                      <FileText size={14} />「{utterance.text}」
                      {meetingReference ? <small>会議の出典: {meetingReference.topicTitle} / {meetingReference.itemTitle}</small> : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
