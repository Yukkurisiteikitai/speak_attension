import { useEffect, useMemo, useState } from "react";
import type { AnalyzedSegment, MeetingSummary, MeetingSummaryStatus } from "../types/topic";
import { MEETING_SUMMARY_CATEGORY_LABELS, MEETING_SUMMARY_CATEGORY_ORDER } from "../utils/meetingSynthesis";

function EditableTitle({ value, onCommit }: { value: string; onCommit: (newValue: string) => void }) {
  const [editing, setEditing] = useState(false);
  const commit = (title: string) => {
    setEditing(false);
    onCommit(title);
  };
  return (
    <div className="editable-title">
      {editing ? (
        <input
          aria-label="タイトルを編集"
          autoFocus
          defaultValue={value}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
            if (event.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span>{value}</span>
      )}
      {!editing && <button type="button" onClick={() => setEditing(true)}>編集</button>}
    </div>
  );
}

type MeetingSummaryGraphProps = {
  summary: MeetingSummary;
  status: MeetingSummaryStatus;
  error: string | null;
  stale: boolean;
  startedAt: number | null;
  segments: AnalyzedSegment[];
  onBack: () => void;
  onRefresh: () => void;
  onRename: (nodeId: string, title: string) => void;
  onStartIdeaSession: (selectedItemIds: string[]) => void;
};

function estimateOrganizationSeconds(segmentCount: number): number {
  return Math.min(30, Math.max(6, 4 + Math.ceil(segmentCount / 5) * 3));
}

function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function OrganizationProgress({ startedAt, status, segmentCount }: { startedAt: number | null; status: MeetingSummaryStatus; segmentCount: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "refining") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [status]);
  if (status !== "refining" || !startedAt) return null;

  const estimate = estimateOrganizationSeconds(segmentCount);
  const elapsed = Math.max(0, (now - startedAt) / 1_000);
  const progress = Math.min(90, 25 + (elapsed / estimate) * 65);
  return (
    <div className="organization-progress" aria-live="polite">
      <div><span>AI統合中</span><strong>{formatSeconds(elapsed)} / 約{formatSeconds(estimate)}</strong></div>
      <p>（整理済み {segmentCount} / {segmentCount} 発言）</p>
      <div className="organization-progress-track" role="progressbar" aria-label="会議整理の進捗" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>全発言の規則整理は完了しています。残りはローカルAIによる議題統合で、予想時間はモデルの処理速度で前後します。</small>
    </div>
  );
}

export function MeetingSummaryGraph({ summary, status, error, stale, startedAt, segments, onBack, onRefresh, onRename, onStartIdeaSession }: MeetingSummaryGraphProps) {
  const [selectedIdeaItemIds, setSelectedIdeaItemIds] = useState<Set<string>>(() => new Set());
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectedIdeaItemIds(new Set());
    setExpandedEvidenceIds(new Set());
  }, [summary.generatedAt]);

  const segmentById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);

  const toggleIdeaItem = (itemId: string) => setSelectedIdeaItemIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    return next;
  });

  const toggleEvidenceExpanded = (itemId: string) => setExpandedEvidenceIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    return next;
  });

  const sourceLabel = status === "refining" ? "規則で整理済み・AIで整え中…" : status === "llm" ? "AIで整理" : status === "error" ? "規則で整理（AIは利用できませんでした）" : "規則で整理";

  if (!summary.topics.length) {
    return (
      <section className="graph-panel meeting-summary-map" aria-label="会議終了時の整理一覧">
        <div className="graph-title">
          <div><h2>会議の整理一覧</h2><span>{sourceLabel}</span></div>
          <div className="summary-actions">
            <button type="button" onClick={onBack}>ライブ表示に戻る</button>
            <button type="button" onClick={onRefresh}>再整理</button>
            <button
              type="button"
              className="summary-start-ideas"
              disabled={selectedIdeaItemIds.size === 0}
              onClick={() => onStartIdeaSession([...selectedIdeaItemIds])}
            >
              選択した課題でアイデア出し ({selectedIdeaItemIds.size})
            </button>
          </div>
        </div>
        {stale ? <p className="summary-stale">新しい発言があります。再整理すると反映されます。</p> : null}
        {error ? <p className="summary-error">{error}</p> : null}
        <OrganizationProgress startedAt={startedAt} status={status} segmentCount={segments.length} />
        <p className="summary-empty">整理された議題はまだありません。</p>
      </section>
    );
  }

  return (
    <section className="graph-panel meeting-summary-map" aria-label="会議終了時の整理一覧">
      <div className="graph-title">
        <div><h2>会議の整理一覧</h2><span>{sourceLabel}</span></div>
        <div className="summary-actions">
          <button type="button" onClick={onBack}>ライブ表示に戻る</button>
          <button type="button" onClick={onRefresh}>再整理</button>
          <button
            type="button"
            className="summary-start-ideas"
            disabled={selectedIdeaItemIds.size === 0}
            onClick={() => onStartIdeaSession([...selectedIdeaItemIds])}
          >
            選択した課題でアイデア出し ({selectedIdeaItemIds.size})
          </button>
        </div>
      </div>
      {stale ? <p className="summary-stale">新しい発言があります。再整理すると反映されます。</p> : null}
      {error ? <p className="summary-error">{error}</p> : null}
      <OrganizationProgress startedAt={startedAt} status={status} segmentCount={segments.length} />

      <div className="summary-topics-container">
        {summary.topics.map((topic) => (
          <section key={topic.id} className="summary-topic-card">
            <h3 className="summary-topic-title">
              <EditableTitle value={topic.title} onCommit={(newTitle) => onRename(topic.id, newTitle)} />
            </h3>

            <table className="summary-table">
              <thead>
                <tr>
                  <th>種別</th>
                  <th>内容</th>
                  <th>状態</th>
                  <th>根拠</th>
                  <th>担当</th>
                  <th>期限</th>
                  <th aria-label="アイデア出し"></th>
                </tr>
              </thead>
              <tbody>
                {MEETING_SUMMARY_CATEGORY_ORDER.flatMap((category) => {
                  const items = topic.items.filter((item) => item.category === category);
                  if (!items.length) return [];

                  return items.map((item) => {
                    const evidence = item.evidenceSegmentIds
                      .map((segmentId) => segmentById.get(segmentId))
                      .filter((segment): segment is AnalyzedSegment => Boolean(segment))
                      .sort((left, right) => left.createdAt - right.createdAt);

                    const isEvidenceExpanded = expandedEvidenceIds.has(item.id);
                    const isSelectableForIdeas = item.category === "issue" || item.category === "unresolved";

                    return (
                      <tr key={item.id} className={`summary-item-row ${isSelectableForIdeas && selectedIdeaItemIds.has(item.id) ? "is-idea-selected" : ""}`}>
                        <td className="summary-cell-category">
                          <span className={`summary-category-tag category-${item.category}`}>
                            {MEETING_SUMMARY_CATEGORY_LABELS[item.category]}
                          </span>
                        </td>
                        <td className="summary-cell-content">
                          <EditableTitle value={item.title} onCommit={(newTitle) => onRename(item.id, newTitle)} />
                        </td>
                        <td className="summary-cell-status">—</td>
                        <td className="summary-cell-evidence">
                          {evidence.length > 0 ? (
                            <div className="summary-evidence-column">
                              <button
                                type="button"
                                className="summary-toggle"
                                onClick={() => toggleEvidenceExpanded(item.id)}
                              >
                                {isEvidenceExpanded ? "−" : "＋"}原文 {evidence.length}件
                              </button>
                              {isEvidenceExpanded && (
                                <div className="summary-evidence-expanded">
                                  {evidence.map((segment) => (
                                    <div key={segment.id} className="summary-evidence-quote">
                                      {segment.text}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="summary-cell-owner">—</td>
                        <td className="summary-cell-deadline">—</td>
                        <td className="summary-cell-checkbox">
                          {isSelectableForIdeas && (
                            <label className="summary-idea-select">
                              <input
                                type="checkbox"
                                checked={selectedIdeaItemIds.has(item.id)}
                                onChange={() => toggleIdeaItem(item.id)}
                              />
                              <span className="sr-only">アイデア出しに選択</span>
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </section>
  );
}
