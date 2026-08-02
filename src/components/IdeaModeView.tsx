import {
  Background,
  ReactFlow,
} from "@xyflow/react";
import { useMemo, useState } from "react";
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

function phaseLabel(phase: IdeaPhase): string {
  if (phase === "capture") return "発散中(キーワード収集)";
  if (phase === "grouping") return "グループ化中…";
  return "整理中(採用・保留・却下を選択)";
}

export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
  const idea = useIdeaSession(store);
  const speech = useSpeechRecognition({ onFinalText: (text) => idea.addUtterance(text, "speech") });
  const [manualText, setManualText] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const { connectionStatus: llmStatus, checkConnection: checkLlmConnection } = useLlmConnectionCheck({
    settings: llmSettings,
    onUpdateSettings: updateLlmSettings,
  });
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const { session } = idea;
  const phase = session.phase;

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

  const decisionCounts = useMemo(
    () => countIdeaDecisions(session.keywords),
    [session.keywords],
  );
  const inheritedMeetingItems = useMemo(
    () => collectIdeaMeetingSourceItems(session.utterances),
    [session.utterances],
  );
  const utterancesById = useMemo(
    () => new Map(session.utterances.map((utterance) => [utterance.id, utterance])),
    [session.utterances],
  );

  return (
    <section className="dashboard-grid idea-mode" aria-label="idea brainstorm mode">
      <div className="graph-column">
        <section className="graph-panel idea-flow" aria-label="idea map">
          <div className="graph-title">
            <h2>アイデアマップ</h2>
            <span>{phaseLabel(phase)}</span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={ideaNodeTypes}
            minZoom={0.2}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (phase === "select" && node.data.kind === "keyword") idea.cycleDecision(node.id);
            }}
          >
            <MapViewportControls fitKey={phase} padding={0.15} />
            <Background gap={20} color="#d5ddd8" />
          </ReactFlow>
        </section>
      </div>

      <div className="rail-column">
        <section className="panel" aria-label="idea controls">
          <h2>アイデア出し</h2>
          <p className="idea-phase-note">{phaseLabel(phase)}</p>
          {inheritedMeetingItems.length > 0 ? (
            <div className="idea-meeting-source">
              <strong>会議から引き継いだテーマ</strong>
              <ul>
                {inheritedMeetingItems.map((item) => (
                  <li key={item.id}>{item.category === "issue" ? "課題" : "未解決"}: {item.title}</li>
                ))}
              </ul>
              <small>根拠となる元発言も出典として保持しています。</small>
            </div>
          ) : null}

          {phase === "capture" ? (
            <>
              <div className="button-row">
                <button type="button" onClick={speech.isListening ? speech.stop : speech.start} disabled={!speech.isSupported}>
                  {speech.isListening ? "🎙 停止" : "🎙 音声入力を開始"}
                </button>
                <button type="button" onClick={finishCapture} disabled={session.keywords.length === 0}>
                  出し終わった → グループ分け
                </button>
              </div>
              {speech.error ? <p className="error-text">{speech.error}</p> : null}
              {speech.interimText ? <p className="idea-interim">…{speech.interimText}</p> : null}
              <textarea
                rows={2}
                placeholder="テキストでアイデアを追加(Cmd/Ctrl+Enterで追加)"
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    submitManualText();
                  }
                }}
              />
              <div className="button-row">
                <button type="button" onClick={submitManualText} disabled={!manualText.trim()}>
                  追加
                </button>
                <button type="button" onClick={() => setIsResetConfirmOpen(true)}>
                  リセット
                </button>
              </div>

              <div className="idea-llm-settings">
                <label>
                  <input type="checkbox" checked={useLlm} onChange={(event) => setUseLlm(event.target.checked)} />
                  グループ分けにローカルLLM(LM Studio)を使う
                </label>
                {useLlm ? (
                  <>
                    <input
                      type="text"
                      value={llmSettings.baseUrl}
                      onChange={(event) => updateLlmSettings({ baseUrl: event.target.value })}
                      placeholder="http://127.0.0.1:1234/v1"
                    />
                    <input
                      type="text"
                      value={llmSettings.model}
                      onChange={(event) => updateLlmSettings({ model: event.target.value })}
                      placeholder="model id(接続確認で自動入力)"
                    />
                    <div className="button-row">
                      <button type="button" onClick={() => void checkLlmConnection()}>
                        接続確認
                      </button>
                    </div>
                    {llmStatus ? (
                      <p
                        className={`idea-llm-status ${
                          llmStatus.includes("失敗") ? "is-error" : llmStatus.includes("成功") ? "is-success" : ""
                        }`}
                      >
                        {llmStatus}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          {phase === "grouping" ? <p>キーワードをグループに分けています…</p> : null}

          {phase === "select" ? (
            <>
              {idea.groupingNote ? <p className="idea-llm-status">{idea.groupingNote}</p> : null}
              <p>採用 {decisionCounts.adopted}・保留 {decisionCounts.hold}・却下 {decisionCounts.rejected}</p>
              <p className="idea-phase-note">マップ上ではクリックするたびに「保留 → 採用 → 却下」と切り替わります。</p>
              <div className="idea-group-editor" aria-label="グループ名の編集">
                <strong>グループ名</strong>
                {session.groups.map((group) => (
                  <label key={group.id}>
                    <span>{group.keywordIds.length}件</span>
                    <input
                      aria-label={`${group.title}のグループ名`}
                      defaultValue={group.title}
                      key={`${group.id}-${group.title}`}
                      onBlur={(event) => idea.renameGroup(group.id, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="button-row">
                <button type="button" onClick={() => { idea.resumeCapture(); setMarkdown(null); }}>
                  まだ出す(発散に戻る)
                </button>
                <button type="button" onClick={() => setMarkdown(renderIdeaMarkdown(session))}>
                  結果を出力
                </button>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => downloadFile(`idea-session-${Date.now()}.md`, renderIdeaMarkdown(session), "text/markdown")}
                >
                  Markdown保存
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      `idea-session-${Date.now()}.json`,
                      JSON.stringify(buildIdeaSessionExport(session), null, 2),
                      "application/json",
                    )
                  }
                >
                  セッションJSON保存(RAG用)
                </button>
              </div>
              {markdown ? <textarea rows={14} readOnly value={markdown} /> : null}
            </>
          ) : null}
        </section>

        <section className="panel idea-keyword-list" aria-label="idea keywords">
          <h2>キーワード({session.keywords.length})</h2>
          <ul>
            {[...session.keywords]
              .sort((left, right) => right.firstMentionedAt - left.firstMentionedAt)
              .map((keyword) => {
                const firstUtterance = utterancesById.get(keyword.utteranceIds[0]);
                return (
                  <li key={keyword.id} className={`is-${keyword.decision}`}>
                    <div className="idea-keyword-row">
                      <span className="idea-keyword-chip">
                        {keyword.label}
                        {keyword.mentionCount > 1 ? ` ×${keyword.mentionCount}` : ""}
                      </span>
                      {phase === "select" ? (
                        <div className="idea-decision-buttons" aria-label={`${keyword.label}の状態`}>
                          {(["adopted", "hold", "rejected"] as const).map((decision) => (
                            <button
                              type="button"
                              className={`decision-${decision}`}
                              aria-pressed={keyword.decision === decision}
                              key={decision}
                              onClick={() => idea.setDecision(keyword.id, decision)}
                            >
                              {decisionLabel(decision)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {firstUtterance ? <small>「{firstUtterance.text}」</small> : null}
                  </li>
                );
              })}
          </ul>
          {session.keywords.length === 0 ? <p className="idea-phase-note">話し始めるとキーワードがこことマップに増えていきます。</p> : null}
        </section>
      </div>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="セッションをリセットしますか?"
        description="収集したキーワードと発言はすべて削除され、元に戻せません。"
        confirmLabel="リセットする"
        onConfirm={() => {
          speech.stop();
          idea.reset();
          setMarkdown(null);
          setIsResetConfirmOpen(false);
        }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </section>
  );
}
