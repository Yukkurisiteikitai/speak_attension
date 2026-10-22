import type { AnalyzedSegment, MeetingDecisionGraph } from "../types/topic";
import type { DiscussionPrompt } from "../utils/meetingProgress";
import { finalReviewQuestions, type MeetingReview } from "../utils/meetingReview";
import { useState } from "react";

export function MeetingReviewPanel({ review, onChange, remaining, prompts, carryover, graph, segments, onExplore }: {
  review: MeetingReview; onChange: (review: MeetingReview) => void; remaining: number;
  prompts: DiscussionPrompt[]; carryover: DiscussionPrompt[]; graph: MeetingDecisionGraph;
  segments: AnalyzedSegment[]; onExplore: (id: string) => void;
}) {
  const [minutes, setMinutes] = useState(10);
  const finalizing = review.phase === "final" || (review.phase === "review" && remaining <= 120);
  const pending = finalizing || review.phase === "complete" ? prompts.filter((p) => p.status === "open" || p.status === "deferred") : carryover;
  return <section className="progress-guidance" aria-label="確認・改善の進行">
    <h3>{review.phase === "discussion" ? "議論中" : review.phase === "complete" ? "確認終了" : finalizing ? "振り返り・最終確認" : "確認・改善"}</h3>
    {review.deadline && review.phase !== "complete" ? <p role="timer">残り {Math.floor(remaining / 60)}分{remaining % 60}秒{remaining === 0 ? "（時間終了・未確認の項目を記録してください）" : ""}</p> : null}
    <label>残り時間（分）<input type="number" min={1} max={180} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
    <button disabled={!Number.isFinite(minutes) || minutes < 1 || minutes > 180 || !segments.length} onClick={() => onChange({ ...review, phase: "review", deadline: Date.now() + minutes * 60_000, confirmations: ["", "", ""] })}>{review.phase === "discussion" ? "確認・改善を始める" : "残り時間を設定して確認・改善へ"}</button>
    {review.phase === "discussion" ? <p>議論中は質問を表示しません。確認に入るタイミングで開始してください。</p> : <>
      <button onClick={() => onChange({ ...review, phase: "discussion", deadline: null })}>議論に戻る</button>
      <details open={finalizing}><summary>振り返り：決定・変更・これまでの回答</summary>
        {graph.nodes.filter((node) => node.type === "decision" || node.type === "action" || node.type === "outcome").map((node) => <p key={node.id}><button onClick={() => onExplore(node.id)}>{node.label}（根拠を確認）</button>{node.action ? <span> ／ 担当：{node.action.owner || "未定"} ／ 期限：{node.action.deadline || "未定"}</span> : null}</p>)}
        {prompts.filter((prompt) => prompt.status === "answered").map((prompt) => <p key={prompt.id}>{prompt.question} → {segments.find((segment) => segment.id === prompt.answerSegmentId)?.text}</p>)}
        <p>「発言順に読む」と時間スライダーから、結論に至る経緯を確認できます。</p>
      </details>
      {review.phase === "review" && !finalizing ? <><p>未確認の前提・未解決の質問、決定、担当・期限の順に優先します。1問約1分、最後の2分は振り返りに確保します。</p><button onClick={() => onChange({ ...review, phase: "final" })}>振り返り・最終確認へ</button></> : null}
      <details open={finalizing}><summary>持ち越し候補（{pending.length}件）</summary>{pending.map((prompt) => <p key={prompt.id}>{prompt.question} {prompt.status === "deferred" ? "（保留）" : "（未回答）"}</p>)}</details>
      {finalizing ? <div>{finalReviewQuestions.map((question, index) => <label key={question}>{question}<textarea rows={2} value={review.confirmations[index]} onChange={(event) => onChange({ ...review, phase: "final", confirmations: review.confirmations.map((value, i) => i === index ? event.target.value : value) })} /></label>)}
        <p>ずれや漏れがあれば「議論に戻る」で補足してください。発言・アクションが更新された場合は、最終確認をやり直します。</p>
        <button disabled={review.confirmations.some((value) => !value.trim())} onClick={() => onChange({ ...review, phase: "complete" })}>確認結果を記録して終了</button>
      </div> : null}
      {review.phase === "complete" ? <><p>最終確認を記録しました。未回答・保留は持ち越しとして残り、確認結果とともに出力できます。</p>{review.confirmations.map((value, index) => <p key={index}>{finalReviewQuestions[index]}：{value}</p>)}</> : null}
    </>}
  </section>;
}
