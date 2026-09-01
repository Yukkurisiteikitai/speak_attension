import { Background, ReactFlow } from "@xyflow/react";
import {
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Grid2X2,
  Lightbulb,
  ListFilter,
  Mic,
  Plus,
  RotateCcw,
  Sparkles,
  SquarePen,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IdeaSessionStore } from "../hooks/ideaSessionStore";
import { useIdeaSession } from "../hooks/useIdeaSession";
import { useLlmConnectionCheck } from "../hooks/useLlmConnectionCheck";
import { useLlmSettings } from "../hooks/useLlmSettings";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { downloadFile } from "../lib/download";
import {
  buildIdeaSessionExport,
  collectIdeaMeetingSourceItems,
  countIdeaDecisions,
  renderIdeaMarkdown,
  type IdeaPhase,
} from "../utils/ideaSession";
import { ConfirmDialog } from "./ConfirmDialog";
import { buildIdeaFlowElements, decisionLabel, ideaNodeTypes } from "./ideaFlow";
import { MapViewportControls } from "./MapViewportControls";

const SESSION_LENGTH_MS = 20 * 60 * 1000;

function phaseLabel(phase: IdeaPhase): string {
  if (phase === "capture") return "アイデア出し中・自由にどうぞ！";
  if (phase === "grouping") return "グループ化しています…";
  return "採用するアイデアを選びましょう";
}

function remainingTimeLabel(startedAt: number, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((startedAt + SESSION_LENGTH_MS - now) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
  const idea = useIdeaSession(store);
  const speech = useSpeechRecognition({ onFinalText: (text) => idea.addUtterance(text, "speech") });
  const [manualText, setManualText] = useState("");
  const [memo, setMemo] = useState(() => window.localStorage.getItem("speak_attension.ideaMemo") ?? "");
  const [memoSaved, setMemoSaved] = useState(true);
  const [useLlm, setUseLlm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const { connectionStatus: llmStatus, checkConnection: checkLlmConnection } = useLlmConnectionCheck({
    settings: llmSettings,
    onUpdateSettings: updateLlmSettings,
  });
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const { session } = idea;
  const phase = session.phase;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMemoSaved(false);
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("speak_attension.ideaMemo", memo);
      setMemoSaved(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [memo]);

  const { nodes, edges } = useMemo(
    () => buildIdeaFlowElements(session),
    [phase, session.groups, session.keywords, session.title],
  );

  const finishCapture = () => {
    speech.stop();
    void idea.finishCapture({ llmSettings: useLlm ? llmSettings : null });
  };

  const submitManualText = () => {
    const text = manualText.trim();
    if (!text) return;
    idea.addUtterance(text, "manual");
    setManualText("");
  };

  const decisionCounts = useMemo(() => countIdeaDecisions(session.keywords), [session.keywords]);
  const inheritedMeetingItems = useMemo(
    () => collectIdeaMeetingSourceItems(session.utterances),
    [session.utterances],
  );
  const utterancesById = useMemo(
    () => new Map(session.utterances.map((utterance) => [utterance.id, utterance])),
    [session.utterances],
  );

  return (
    <section className="idea-workspace" aria-label="アイデア出しモード">
      <header className="idea-header">
        <div className="idea-brand">
          <h1>会議アイデアマップ</h1>
          <p>みんなの意見を見える化して、最高の結論へ</p>
        </div>

        <div className="idea-progress" aria-label="進行フェーズ">
          <strong>フェーズ</strong>
          <ol>
            <li className={phase === "capture" ? "is-current" : "is-complete"}><span>1</span>アイデア出し</li>
            <li className={phase === "grouping" ? "is-current" : phase === "select" ? "is-complete" : ""}><span>2</span>グループ化</li>
            <li className={phase === "select" ? "is-current" : ""}><span>3</span>採用・却下</li>
          </ol>
        </div>

        <div className="idea-session-metrics">
          <div><span><Clock3 size={15} />残り時間</span><strong>{remainingTimeLabel(session.startedAt, now)}</strong></div>
          <div><span><Users size={18} />参加者</span><strong>1<small>人</small></strong></div>
        </div>
      </header>

      <div className="idea-board-grid">
        <aside className="idea-left-rail">
          <section className="idea-card idea-agenda-card">
            <h2>現在の議題</h2>
            <strong>{inheritedMeetingItems[0]?.title ?? "新しいアイデアを考えよう！"}</strong>
            <p>{inheritedMeetingItems.length > 0 ? "会議で選んだテーマをもとに、解決案を広げます。" : "音声やテキストで、思いついたことを自由に追加してください。"}</p>
            <div className="idea-status-pill"><Lightbulb size={15} />{phaseLabel(phase)}</div>
          </section>

          <section className="idea-card idea-control-card">
            <h2>操作パネル <small>（ファシリテーター用）</small></h2>
            {phase === "capture" ? (
              <>
                <button className={`idea-action-button is-primary ${speech.isListening ? "is-listening" : ""}`} type="button" onClick={speech.isListening ? speech.stop : speech.start} disabled={!speech.isSupported}>
                  <Mic size={19} />{speech.isListening ? "音声入力を停止" : "音声入力を開始"}
                </button>
                <button className="idea-action-button" type="button" onClick={finishCapture} disabled={session.keywords.length === 0}>
                  <Grid2X2 size={18} />グループ化する
                </button>
              </>
            ) : null}
            {phase === "grouping" ? <div className="idea-working"><Sparkles size={18} />アイデアを整理しています…</div> : null}
            {phase === "select" ? (
              <>
                <button className="idea-action-button" type="button" onClick={() => { idea.resumeCapture(); setMarkdown(null); }}><Plus size={18} />アイデア出しに戻る</button>
                <button className="idea-action-button" type="button" onClick={() => setMarkdown(renderIdeaMarkdown(session))}><CheckCircle2 size={18} />採用結果をまとめる</button>
              </>
            ) : null}
            <button className="idea-action-button is-danger-quiet" type="button" onClick={() => setIsResetConfirmOpen(true)}><RotateCcw size={17} />セッションをリセット</button>
            {speech.error ? <p className="error-text">{speech.error}</p> : null}
            {speech.interimText ? <p className="idea-interim">…{speech.interimText}</p> : null}
          </section>

          <section className="idea-card idea-view-card">
            <h2>表示</h2>
            <div className="idea-view-choice is-active"><ListFilter size={17} />すべて表示 <span>{session.keywords.length}</span></div>
            <div className="idea-view-choice"><Grid2X2 size={17} />グループ別 <span>{session.groups.length}</span></div>
            <div className="idea-view-choice"><Users size={17} />入力したアイデア <span>{session.utterances.length}</span></div>
          </section>
        </aside>

        <main className="idea-map-card" aria-label="アイデアマップ">
          <div className="idea-map-heading">
            <div><h2>アイデアマップ</h2><span>（みんなの意見）</span></div>
            {phase === "select" ? <p>採用 {decisionCounts.adopted} ・ 保留 {decisionCounts.hold} ・ 却下 {decisionCounts.rejected}</p> : <p>{session.keywords.length} 件のアイデア</p>}
          </div>
          <div className="idea-map-canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={ideaNodeTypes}
              minZoom={0.2}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => { if (phase === "select" && node.data.kind === "keyword") idea.cycleDecision(node.id); }}
            >
              <MapViewportControls fitKey={phase} padding={0.16} />
              <Background gap={24} size={1} color="#e7ece8" />
            </ReactFlow>
            {session.keywords.length === 0 ? (
              <div className="idea-map-empty"><Lightbulb size={30} /><strong>ここにアイデアが広がります</strong><span>右の入力欄か音声入力から、最初のアイデアを追加しましょう</span></div>
            ) : null}
          </div>
        </main>

        <aside className="idea-right-rail">
          <section className="idea-card idea-memo-card">
            <h2>メモ / 議事メモ</h2>
            <textarea rows={5} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="気づいたことや、次に話したいことをメモ…" />
            <small className={memoSaved ? "is-saved" : ""}><Check size={14} />{memoSaved ? "保存済み" : "保存中…"}</small>
          </section>

          <section className="idea-card idea-input-card">
            <h2>アイデア入力 <small>（その場で追加）</small></h2>
            <textarea rows={4} placeholder="いいアイデアを思いついたらここに入力…" value={manualText} disabled={phase !== "capture"} onChange={(event) => setManualText(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submitManualText(); } }} />
            <button className="idea-action-button is-primary" type="button" onClick={submitManualText} disabled={phase !== "capture" || !manualText.trim()}><Lightbulb size={18} />追加する</button>
            <p>⌘ / Ctrl + Enter でも追加できます</p>
          </section>

          <section className="idea-card idea-ai-card">
            <h2>AI サポート <small>（オプション）</small></h2>
            <label className="idea-ai-toggle"><input type="checkbox" checked={useLlm} onChange={(event) => setUseLlm(event.target.checked)} /><Bot size={18} />ローカルAIでグループ化</label>
            {useLlm ? (
              <div className="idea-llm-settings">
                <input type="text" value={llmSettings.baseUrl} onChange={(event) => updateLlmSettings({ baseUrl: event.target.value })} aria-label="LM Studio 接続先" />
                <input type="text" value={llmSettings.model} onChange={(event) => updateLlmSettings({ model: event.target.value })} placeholder="モデル ID" aria-label="LM Studio モデル ID" />
                <button type="button" onClick={() => void checkLlmConnection()}><Sparkles size={15} />接続確認</button>
                {llmStatus ? <p className={`idea-llm-status ${llmStatus.includes("失敗") ? "is-error" : llmStatus.includes("成功") ? "is-success" : ""}`}>{llmStatus}</p> : null}
              </div>
            ) : null}
          </section>

          {phase === "select" ? (
            <section className="idea-card idea-export-card">
              <h2>結果を保存</h2>
              <button type="button" onClick={() => downloadFile(`idea-session-${Date.now()}.md`, renderIdeaMarkdown(session), "text/markdown")}><FileText size={16} />Markdown</button>
              <button type="button" onClick={() => downloadFile(`idea-session-${Date.now()}.json`, JSON.stringify(buildIdeaSessionExport(session), null, 2), "application/json")}><Download size={16} />セッション JSON</button>
            </section>
          ) : null}
        </aside>
      </div>

      {phase === "select" ? (
        <section className="idea-selection-drawer" aria-label="アイデアの採否とグループ名">
          <div className="idea-group-editor">
            <strong>グループ名</strong>
            {session.groups.map((group) => (
              <label key={group.id}><span>{group.keywordIds.length}件</span><input aria-label={`${group.title}のグループ名`} defaultValue={group.title} key={`${group.id}-${group.title}`} onBlur={(event) => idea.renameGroup(group.id, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
            ))}
          </div>
          <ul className="idea-selection-list">
            {[...session.keywords].sort((left, right) => right.firstMentionedAt - left.firstMentionedAt).map((keyword) => {
              const firstUtterance = utterancesById.get(keyword.utteranceIds[0]);
              return (
                <li key={keyword.id}>
                  <div><strong>{keyword.label}</strong>{firstUtterance ? <small>「{firstUtterance.text}」</small> : null}</div>
                  <div className="idea-decision-buttons" aria-label={`${keyword.label}の状態`}>
                    {(["adopted", "hold", "rejected"] as const).map((decision) => (
                      <button type="button" className={`decision-${decision}`} aria-pressed={keyword.decision === decision} key={decision} onClick={() => idea.setDecision(keyword.id, decision)}>{decisionLabel(decision)}</button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {idea.groupingNote ? <p className="idea-llm-status">{idea.groupingNote}</p> : null}
          {markdown ? <textarea rows={12} readOnly value={markdown} aria-label="Markdown出力" /> : null}
        </section>
      ) : null}

      <footer className="idea-footer">
        <span>IdeaMap v2.0.0</span>
        <p><CheckCircle2 size={15} />みんなの意見を尊重しましょう　・　批判は禁物！　・　自由な発想を歓迎します</p>
        <span><SquarePen size={14} /> Shift + Enter で送信</span>
      </footer>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="セッションをリセットしますか?"
        description="収集したキーワードと発言はすべて削除され、元に戻せません。"
        confirmLabel="リセットする"
        onConfirm={() => { speech.stop(); idea.reset(); setMarkdown(null); setIsResetConfirmOpen(false); }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </section>
  );
}
