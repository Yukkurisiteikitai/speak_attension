import { useEffect, useMemo, useState } from "react";
import { Background, ReactFlow, useReactFlow } from "@xyflow/react";
import type { AnalyzedSegment, ConversationTreeState, MeetingDecisionGraph } from "../types/topic";
import { buildMeetingProgress, renderMeetingProgressMarkdown, type DiscussionPrompt } from "../utils/meetingProgress";
import { projectMeetingProgress } from "../utils/meetingProgressLayout";
import { downloadFile } from "../lib/download";
import { MapViewportControls } from "./MapViewportControls";

type Props = {
  tree: ConversationTreeState;
  graph: MeetingDecisionGraph;
  segments: AnalyzedSegment[];
  prompts: DiscussionPrompt[];
  reviewStatus: "rules" | "refining" | "ai" | "error";
  reviewError: string | null;
  onAnswer: (id: string, text: string, needsResearch: boolean) => void;
  onDefer: (id: string, deferred: boolean) => void;
  onExplore: (id: string) => void;
  onSubmit: (text: string) => void;
  armedPromptId: string | null;
  onArmPrompt: (id: string | null, needsResearch?: boolean) => void;
};
const statusLabels = { open: "次に確認", deferred: "保留中", answered: "回答記録済み", satisfied: "状況更新済み" };

function FocusProgressNode({ selectedId }: { selectedId: string | null }) {
  const { getNode, setCenter } = useReactFlow();
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      const node = getNode(selectedId);
      if (node) void setCenter(node.position.x + 145, node.position.y + 75, { zoom: 0.85, duration: 250 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedId, getNode, setCenter]);
  return null;
}

export function MeetingProgressMap({ tree, graph, segments, prompts, reviewStatus, reviewError, onAnswer, onDefer, onExplore, onSubmit, armedPromptId, onArmPrompt }: Props) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSequence, setShowSequence] = useState(false);
  const [autoFit, setAutoFit] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [answer, setAnswer] = useState("");
  const [needsResearch, setNeedsResearch] = useState(false);
  const [utterance, setUtterance] = useState("");
  const count = cursor === null ? segments.length : Math.min(cursor, segments.length);
  const isLive = cursor === null;
  const visibleSegments = useMemo(() => segments.slice(0, count), [segments, count]);
  const fullProgress = useMemo(() => buildMeetingProgress(tree, graph, segments, prompts), [tree, graph, segments, prompts]);
  const available = prompts.filter((prompt) => showHistory || prompt.status === "open" || prompt.status === "deferred");
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedId || selectedId?.startsWith(`${prompt.id}-branch-`));
  const visiblePrompts = available.slice(0, 4);
  if (selectedPrompt && !visiblePrompts.some((prompt) => prompt.id === selectedPrompt.id)) visiblePrompts.push(selectedPrompt);
  const visiblePromptKey = visiblePrompts.map((prompt) => prompt.id).join("|");
  const progress = useMemo(() => {
    const ids = new Set(visibleSegments.map((segment) => segment.id));
    const cutoff = visibleSegments[visibleSegments.length - 1]?.createdAt ?? -Infinity;
    const nodes = graph.nodes.filter((node) => node.provenance.utteranceIds.length ? node.provenance.utteranceIds.every((id) => ids.has(id)) : isLive || node.createdAt <= cutoff);
    const nodeIds = new Set(nodes.map((node) => node.id));
    return buildMeetingProgress({ ...tree, nodes: tree.nodes.filter((node) => ids.has(node.segmentId)) },
      { nodes, edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)) }, visibleSegments,
      isLive ? prompts.filter((prompt) => visiblePrompts.some((item) => item.id === prompt.id)) : []);
  }, [tree, graph, visibleSegments, prompts, isLive, visiblePromptKey]);
  const projection = useMemo(() => projectMeetingProgress(progress, showSequence), [progress, showSequence]);
  const selectedNode = progress.nodes.find((node) => node.id === selectedId);
  const selectedSegment = visibleSegments.find((segment) => segment.id === selectedNode?.segmentId);
  const select = (id: string) => { setSelectedId(id); setAutoFit(false); setAnswer(""); setNeedsResearch(false); };
  const exportProgress = (format: "json" | "md") => downloadFile(`meeting-progress.${format}`,
    format === "json" ? JSON.stringify({ format: "meeting-progress", version: 1, progress: fullProgress, segments, decisionGraph: graph }, null, 2) : renderMeetingProgressMarkdown(fullProgress, segments),
    format === "json" ? "application/json" : "text/markdown");

  return <section className="panel meeting-progress-map" aria-label="会議の流れと次の検討">
    <div className="section-head"><h2>会議の流れと次の検討</h2><span aria-live="polite">{isLive ? "ライブ更新" : `${count}発言目まで`}</span></div>
    <p>課題・理由・提案から決定へのつながりを表示します。黄色の点線は、これから確認する問いと条件付きの予定です。</p>
    <form className="progress-quick-input" onSubmit={(event) => { event.preventDefault(); if (!utterance.trim()) return; onSubmit(utterance); setUtterance(""); setCursor(null); }}>
      <label htmlFor="progress-utterance">会議の発言を追加</label>
      <div className="manual-input-row"><textarea id="progress-utterance" rows={2} value={utterance} onChange={(event) => setUtterance(event.target.value)} placeholder="例：今日は連絡方法について決めます" /><button type="submit" disabled={!utterance.trim()}>発言を追加</button></div>
    </form>
    {armedPromptId ? <p role="status">次の発言の回答先：{prompts.find((prompt) => prompt.id === armedPromptId)?.question}<button onClick={() => onArmPrompt(null)}>回答先の指定を解除</button></p> : null}
    <div className="progress-toolbar">
      <label><input type="checkbox" checked={showSequence} onChange={(event) => setShowSequence(event.target.checked)} />発言順の線を表示</label>
      <label><input type="checkbox" checked={autoFit} onChange={(event) => setAutoFit(event.target.checked)} />更新時に全体表示</label>
      <button onClick={() => exportProgress("md")}>流れ・予定をMarkdown出力</button>
      <button onClick={() => exportProgress("json")}>出典付きJSON</button>
    </div>
    <div className="progress-time-control">
      <label htmlFor="meeting-progress-time">会議の経過をたどる：{count} / {segments.length} 発言</label>
      <input id="meeting-progress-time" type="range" min={0} max={segments.length} value={count} onChange={(event) => { setCursor(Number(event.target.value)); setSelectedId(null); }} />
      <button disabled={isLive} onClick={() => { setCursor(null); setSelectedId(null); }}>現在の会議に戻る</button>
    </div>
    {!isLive ? <p>過去の発言時点を表示中です。現在の質問・予定は「現在の会議に戻る」で確認できます。</p> : null}
    {!segments.length ? <p className="progress-empty">下の手入力、または音声入力で会議を始めてください。発言に応じてマップと次の問いが増えます。</p> : null}
    <div className="progress-flow"><ReactFlow nodes={projection.nodes.map((node) => ({ ...node, selected: node.id === selectedId }))} edges={projection.edges}
      nodesDraggable={false} nodesConnectable={false} minZoom={0.06} maxZoom={1.5} onNodeClick={(_, node) => select(node.id)} proOptions={{ hideAttribution: true }}>
      <Background gap={24} /><MapViewportControls fitKey={isLive ? autoFit ? `live-${segments.length}-${visiblePromptKey}` : "manual-view" : `history-${count}`} /><FocusProgressNode selectedId={selectedId} />
    </ReactFlow></div>
    {selectedSegment ? <article className="state-source"><h3>{selectedNode?.sequence}. {selectedNode?.kind}</h3><p>{selectedSegment.text}</p>
      <small>{selectedSegment.metadata?.speaker ?? "発言者不明"} ／ {new Date(selectedSegment.createdAt).toLocaleTimeString("ja-JP")}</small>
      <button onClick={() => onExplore(`utterance-${selectedSegment.id}`)}>決定・根拠の詳細を開く</button>
    </article> : null}
    {selectedNode?.kind === "実行結果・更新" ? <article className="state-source"><h3>操作担当者による更新</h3><p>{selectedNode.label}</p><button onClick={() => onExplore(selectedNode.id)}>変更前後と根拠を開く</button></article> : null}
    {isLive ? <div className="progress-guidance">
      <div className="section-head"><h3>マップに連動する問い・検討予定</h3><span aria-live="polite">{reviewStatus === "refining" ? "AIが文脈を確認中" : reviewStatus === "ai" ? "AI提案で更新" : "ルール提案で進行中"}</span></div>
      {reviewError ? <p role="status">{reviewError} ルール提案を利用できます。</p> : null}
      <label><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />回答済み・更新済みも表示</label>
      <div className="progress-prompt-list">{available.map((prompt) => <button key={prompt.id} className="state-choice" aria-pressed={selectedPrompt?.id === prompt.id} onClick={() => select(prompt.id)}>
        <small>{statusLabels[prompt.status]} ／ {prompt.source === "ai" ? "AI提案" : "ルール提案"}</small><strong>{prompt.question}</strong>
      </button>)}</div>
      {!available.length ? <p>現在の確認項目はありません。発言が追加されると再評価します。</p> : <p className="empty-text">優先する4件をマップに表示しています。ほかの問いも選択すると、その枝を表示できます。</p>}
      {selectedPrompt ? <article className="progress-question-detail" key={selectedPrompt.id}>
        <h3>{selectedPrompt.question}</h3><p>{selectedPrompt.rationale}</p>
        <ul>{selectedPrompt.branches.map((branch, index) => <li key={index}><strong>{branch.condition}</strong>：{branch.next}</li>)}</ul>
        <details><summary>この問いの根拠発言</summary>{segments.filter((segment) => selectedPrompt.evidenceSegmentIds.includes(segment.id)).map((segment) => <p key={segment.id}>{segment.text}</p>)}</details>
        {selectedPrompt.answerSegmentId ? <p>記録した回答：{segments.find((segment) => segment.id === selectedPrompt.answerSegmentId)?.text}</p> : null}
        {selectedPrompt.status === "open" || selectedPrompt.status === "deferred" ? <form onSubmit={(event) => { event.preventDefault(); if (!answer.trim()) return; onAnswer(selectedPrompt.id, answer, needsResearch); setAnswer(""); }}>
          <label htmlFor="progress-answer">この問いへの回答・分かったこと</label>
          <textarea id="progress-answer" rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="確認した事実や、まだ分からないことを記録" />
          <label><input type="checkbox" checked={needsResearch} onChange={(event) => setNeedsResearch(event.target.checked)} />まだ分からないため、追加確認の分岐へ進む</label>
          <div className="progress-toolbar"><button type="submit" disabled={!answer.trim()}>回答をマップにつなぐ</button>
            <button type="button" onClick={() => onArmPrompt(selectedPrompt.id, needsResearch)}>次の発言を回答として接続</button>
            <button type="button" onClick={() => onDefer(selectedPrompt.id, selectedPrompt.status !== "deferred")}>{selectedPrompt.status === "deferred" ? "今の検討に戻す" : "後で検討する"}</button></div>
          <p className="empty-text">回答は発言として記録されます。担当・期限の確定は「今すること」の対象アクションで更新できます。</p>
        </form> : <button onClick={() => onDefer(selectedPrompt.id, false)}>もう一度検討する</button>}
        {prompts.filter((prompt) => prompt.parentPromptId === selectedPrompt.id).map((prompt) => <button className="state-choice" key={prompt.id} onClick={() => select(prompt.id)}>回答から続く検討：{prompt.question}</button>)}
      </article> : <p>問いを選ぶと、根拠・その先の予定・回答欄を開きます。</p>}
    </div> : null}
    <details className="progress-transcript"><summary>発言順に読む（{visibleSegments.length}件）</summary>{visibleSegments.map((segment, index) => {
      const node = progress.nodes.find((node) => node.segmentId === segment.id);
      return <button className="state-choice" key={segment.id} onClick={() => node && select(node.id)}>{index + 1}. {segment.text}</button>;
    })}</details>
    <p className="empty-text">関連線は発言から推定した候補です。原文を開いて確認できます。会議の記録と予定はJSON・Markdownで持ち出せます。</p>
  </section>;
}
