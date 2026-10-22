import { useMemo, useState } from "react";
import type { AnalyzedSegment, MissingContribution } from "../types/topic";

type MissingContributionPanelProps = { contributions: MissingContribution[]; segments: AnalyzedSegment[] };

function priorityLabel(priority: MissingContribution["priority"]): string {
  return priority === "high" ? "高優先" : priority === "medium" ? "中優先" : "低優先";
}

export function MissingContributionPanel({ contributions, segments }: MissingContributionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const byId = useMemo(() => new Map(segments.map((segment) => [segment.id, segment.text])), [segments]);
  const visible = expanded ? contributions : contributions.slice(0, 3);
  return <section className="panel missing-contribution-panel" aria-label="次に確認すること">
    <div className="section-head"><h2>会議を前に進める確認</h2><span>{contributions.length}件</span></div>
    {contributions.length ? <div className="missing-contribution-list">
      {visible.map((contribution) => <article className={"missing-contribution priority-" + contribution.priority} key={contribution.id}>
        <span className="severity-badge">{priorityLabel(contribution.priority)}</span>
        <strong>{contribution.question}</strong>
        <p><b>発言例</b>: {contribution.exampleUtterance}</p>
        <small><b>不足の理由</b>: {contribution.rationale}</small>
        {contribution.evidenceSegmentIds.length ? <details><summary>根拠発言を見る</summary><ul>{contribution.evidenceSegmentIds.map((id) => <li key={id}>{byId.get(id) ?? "発言を読み込めません"}</li>)}</ul></details> : null}
      </article>)}
    </div> : <p className="empty-text">まだ議題がないため、確認事項はありません。発言を1件追加するとここに表示します。</p>}
    {contributions.length > 3 ? <button type="button" className="show-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "残りを閉じる" : "残り" + (contributions.length - 3) + "件を見る"}</button> : null}
  </section>;
}
