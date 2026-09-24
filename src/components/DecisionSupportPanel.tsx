import { useState } from "react";
import type { AnalyzedSegment, DecisionMaterial, DecisionMaterialStatus, DecisionSupportAnalysis } from "../types/topic";

const statusLabel: Record<DecisionMaterialStatus, string> = { open: "未確認", checked: "確認済み", decided: "決定済み", deferred: "後で判断", accepted: "理解して進む", irrelevant: "対象外", recheck: "前提が変化・再確認" };
const kindLabel: Record<DecisionMaterial["kind"], string> = { comparison: "比較軸", meeting_fact: "会議固有の事実", value_choice: "価値判断" };

export function DecisionSupportPanel({ analysis, segments, onAnalyze, onStatus }: { analysis: DecisionSupportAnalysis; segments: AnalyzedSegment[]; onAnalyze: () => void; onStatus: (id: string, status: DecisionMaterialStatus) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sources = new Map(segments.map((segment) => [segment.id, segment.text]));
  const visible = analysis.materials.filter((material) => ["open", "recheck"].includes(material.status));
  return <section className="panel decision-support-panel" aria-label="判断材料を確認">
    <div className="section-head"><h2>判断材料を確認</h2><span>{analysis.status === "ready" ? `${visible.length}件を表示` : "手動解析"}</span></div>
    <p>会議の発言を根拠に、選択を変え得る条件だけを確認します。推論や仮置き案は、参加者の決定・提案とは区別します。</p>
    <button type="button" onClick={onAnalyze}>判断材料を解析</button>
    {analysis.status === "idle" ? <p className="empty-text">解析は会議の進行を中断しません。必要な時に実行してください。</p> : null}
    {analysis.status === "insufficient_evidence" ? <p role="status">解析不能：現在の発言だけでは、判断に影響する条件を根拠付きで特定できません。会議の記録と既存機能はそのまま利用できます。</p> : null}
    {analysis.status === "ready" && !visible.length ? <p>未確認の判断材料はありません。処理済みの項目は、前提が変わるまで再表示しません。</p> : null}
    {visible.map((material) => <article className="missing-contribution" key={material.id}>
      <small>{kindLabel[material.kind]} ／ {statusLabel[material.status]}</small><h3>{material.title}</h3><strong>{material.question}</strong><p>{material.rationale}</p>
      <div className="progress-toolbar">{(["checked", "decided", "deferred", "accepted", "irrelevant"] as DecisionMaterialStatus[]).map((status) => <button type="button" key={status} onClick={() => onStatus(material.id, status)}>{statusLabel[status]}</button>)}</div>
      <button type="button" onClick={() => setExpanded(expanded === material.id ? null : material.id)} aria-expanded={expanded === material.id}>{expanded === material.id ? "詳細を閉じる" : "根拠・仮説を見る"}</button>
      {expanded === material.id ? <div className="state-source"><p><b>確認済みの発言</b></p><ul>{material.confirmed.map((item) => <li key={item}>{item}</li>)}</ul><p><b>推論・比較用の仮置き</b></p><ul>{material.inferred.length ? material.inferred.map((item) => <li key={item}>{item}</li>) : <li>ありません。価値判断は参加者が決めます。</li>}</ul><p><b>この会話からは分からないこと</b></p><ul>{material.unknown.map((item) => <li key={item}>{item}</li>)}</ul><p><b>条件付きの仮説</b><br />IF {material.conditionalHypothesis.if}<br />AND {material.conditionalHypothesis.and}<br />THEN {material.conditionalHypothesis.then}<br />THEREFORE {material.conditionalHypothesis.therefore}</p><p><b>不要かもしれない理由</b><br />{material.notNeededReason}</p><details><summary>元発言</summary>{material.sourceEvidenceSegmentIds.map((id) => <p key={id}>{sources.get(id) ?? "根拠発言を読み込めません"}</p>)}</details></div> : null}
    </article>)}
  </section>;
}
