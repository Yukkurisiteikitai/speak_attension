import { useMemo, useState } from "react";
import { Background, ReactFlow } from "@xyflow/react";
import type { MeetingDecisionGraph } from "../types/topic";
import { selectCurrentActions, selectDecisionParents } from "../utils/meetingDecisionGraph";
import { actionStatusLabels, actionUrgencyLabels, buildMeetingStateSnapshot, meetingStateLabels, meetingTypeLabels, renderMeetingStateMarkdown, selectPendingMeetingNodes } from "../utils/meetingState";
import { projectMeetingDecisionStep } from "../utils/meetingDecisionLayout";
import { downloadFile } from "../lib/download";
import { MapViewportControls } from "./MapViewportControls";

type Props = { graph: MeetingDecisionGraph; meetingId: string; title: string; selectedId: string | null; onSelect: (id: string | null) => void };
export function MeetingStateMap({ graph, meetingId, title, selectedId, onSelect }: Props) {
  const [history, setHistory] = useState<string[]>([]);
  const actions = selectCurrentActions(graph);
  const pending = selectPendingMeetingNodes(graph);
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const projection = useMemo(() => projectMeetingDecisionStep(graph, selectedId ?? ""), [graph, selectedId]);
  const navigate = (id: string) => { if (id === selectedId) return; setHistory((path) => selectedId ? [...path, selectedId] : path); onSelect(id); };
  const exportState = (format: "json" | "md") => {
    const snapshot = buildMeetingStateSnapshot(graph, { meetingId, title }, Date.now());
    downloadFile(`meeting-state.${format}`, format === "json" ? JSON.stringify(snapshot, null, 2) : renderMeetingStateMarkdown(snapshot), format === "json" ? "application/json" : "text/markdown");
  };
  return <section className="panel meeting-state-map" aria-label="会議の現在状態と根拠マップ">
    <div className="section-head"><h2>現在地点から根拠へ</h2><div><button onClick={() => exportState("md")}>状態をMarkdown出力</button><button onClick={() => exportState("json")}>出典付きJSON</button></div></div>
    <p>今すること {actions.length}件 ／ 未決定・未確認 {pending.length}件</p>
    <p className="empty-text">関連線はルールによる候補です。項目を選び、元発言まで確認できます。</p>
    <ul className="state-legend" aria-label="色の意味">
      <li className="state-choice state-decided">決定・実行中</li>
      <li className="state-choice state-proposed">提案（未採用）</li>
      <li className="state-choice state-unconfirmed">未確認</li>
      <li className="state-choice state-ai_suggested">システム提案</li>
      <li className="state-choice state-human_stated">発言・事実</li>
    </ul>
    <div className="state-overview">
      <div><h3>今すること</h3>{actions.length ? actions.map((node) => <button className={`state-choice state-${node.state}`} key={node.id} onClick={() => navigate(node.id)}><strong>{node.label}</strong><span>{node.action?.owner ?? "未割当"} ／ {node.action?.deadline ?? "期限未設定"} ／ {node.action?.urgency ? actionUrgencyLabels[node.action.urgency] : "優先度未設定"} ／ {actionStatusLabels[node.action?.status ?? "decided"]}</span></button>) : <p>決定済みのアクションはまだありません。</p>}</div>
      <div><h3>未決定・確認が必要</h3>{pending.length ? pending.map((node) => <button className={`state-choice state-${node.state}`} key={node.id} onClick={() => navigate(node.id)}>{meetingTypeLabels[node.type]}: {node.label}</button>) : <p>未決定・未確認の項目はありません。</p>}</div>
    </div>
    <details><summary>すべての決定・課題・結果・発言（{graph.nodes.length}件）</summary><div className="state-node-index">{graph.nodes.map((node) => <button className={`state-choice state-${node.state}`} key={node.id} onClick={() => navigate(node.id)}>{meetingTypeLabels[node.type]}: {node.label}</button>)}</div></details>
    {selected ? <>
      <div className="state-navigation"><button disabled={!history.length} onClick={() => { onSelect(history[history.length - 1] ?? null); setHistory((path) => path.slice(0, -1)); }}>一段戻る</button><button onClick={() => { onSelect(null); setHistory([]); }}>現在地点へ戻る</button></div>
      <div className="decision-step-flow"><ReactFlow nodes={projection.nodes} edges={projection.edges} nodesDraggable={false} nodesConnectable={false} minZoom={0.2} maxZoom={1.5} onNodeClick={(_, node) => navigate(node.id)} proOptions={{ hideAttribution: true }}><Background gap={24} /><MapViewportControls fitKey={selected.id} /></ReactFlow></div>
      <article className="state-source" aria-live="polite"><h3>{meetingTypeLabels[selected.type]} ／ <span className={`decision-state state-${selected.state}`}>{meetingStateLabels[selected.state]}</span></h3><p>{selected.label}</p><p>{new Date(selected.createdAt).toLocaleString("ja-JP")} ／ {selected.speaker ?? "発言者不明"}</p>
        {selected.type === "utterance" ? <p>元発言の全文です。音声は保存していません。</p> : null}
        {selected.actionChange ? <p>操作担当者による更新: {actionStatusLabels[selected.actionChange.before.status ?? "decided"]} → {actionStatusLabels[selected.actionChange.after.status ?? "decided"]}</p> : null}
        {selectDecisionParents(graph, selected.id).filter((node) => node.id !== selected.id).map((node) => <button className={`state-choice state-${node.state}`} key={node.id} onClick={() => navigate(node.id)}>{meetingTypeLabels[node.type]}へ: {node.label}</button>)}
      </article>
    </> : <p className="empty-text">アクションや未決定の項目を選ぶと、決定 → 理由 → 根拠 → 元発言へ一段ずつ進めます。</p>}
  </section>;
}
