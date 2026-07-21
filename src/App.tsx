import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ConversationNodeEditor } from "./components/ConversationNodeEditor";
import { ControlPanel } from "./components/ControlPanel";
import { IdeaModeView } from "./components/IdeaModeView";
import { ManualReplayPanel } from "./components/ManualReplayPanel";
import { MeetingReportPanel } from "./components/MeetingReportPanel";
import { MeetingSummaryGraph } from "./components/MeetingSummaryGraph";
import { TopicGraph } from "./components/TopicGraph";
import { TopicInspector } from "./components/TopicInspector";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { TranscriptReplayPanel } from "./components/TranscriptReplayPanel";
import { createIdeaSessionStore } from "./hooks/ideaSessionStore";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useLlmSettings } from "./hooks/useLlmSettings";
import { useTopicEngine } from "./hooks/useTopicEngine";
import { createIdeaSessionFromMeetingSelection } from "./utils/ideaSession";
import { formatReplayTime } from "./utils/transcriptReplay";
import type { AnalyzedSegment, MeetingSummary, SessionLogEntry } from "./types/topic";

type AppMode = "idea" | "meeting";
type MeetingRailTab = "progress" | "analysis";
type MeetingInputTab = "manual" | "replay" | "transcript";

const WS_URL = "ws://127.0.0.1:8787";

// Keeps a single browser WebSocket for session logs and hides the transport detail from the UI.
function useSessionSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("接続中");

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.addEventListener("open", () => setConnectionStatus("接続済み"));
    socket.addEventListener("close", () => setConnectionStatus("切断"));
    socket.addEventListener("error", () => setConnectionStatus("接続エラー"));

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const sendLog = useCallback((entry: SessionLogEntry) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(entry));
  }, []);

  return { connectionStatus, sendLog };
}

function statusLabel(isSupported: boolean, isListening: boolean): string {
  if (!isSupported) return "Web Speech API が利用できません";
  if (isListening) return "音声認識中(日本語)";
  return "待機中";
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("idea");
  const [ideaStore] = useState(() => createIdeaSessionStore());
  const startIdeaSessionFromMeeting = useCallback(
    (summary: MeetingSummary, segments: AnalyzedSegment[], selectedItemIds: string[]) => {
      ideaStore.replaceSession(createIdeaSessionFromMeetingSelection(summary, segments, selectedItemIds));
      setMode("idea");
    },
    [ideaStore],
  );

  return (
    <main className="app-shell">
      <nav className="mode-switch" aria-label="app mode">
        <button type="button" className={mode === "idea" ? "is-active" : ""} onClick={() => setMode("idea")}>
          アイデア出しモード
        </button>
        <button type="button" className={mode === "meeting" ? "is-active" : ""} onClick={() => setMode("meeting")}>
          会議モード
        </button>
      </nav>
      {mode === "idea" ? (
        <IdeaModeView store={ideaStore} />
      ) : (
        <MeetingMode onStartIdeaSession={startIdeaSessionFromMeeting} />
      )}
    </main>
  );
}

function MeetingMode({
  onStartIdeaSession,
}: {
  onStartIdeaSession: (summary: MeetingSummary, segments: AnalyzedSegment[], selectedItemIds: string[]) => void;
}) {
  const { connectionStatus, sendLog } = useSessionSocket();
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const topicEngine = useTopicEngine({ onLog: sendLog, llmSettings });
  const speech = useSpeechRecognition({ onFinalText: topicEngine.addTranscriptText });
  const [now, setNow] = useState(() => Date.now());
  const [mapMode, setMapMode] = useState<"live" | "summary">("live");
  const [railTab, setRailTab] = useState<MeetingRailTab>("progress");
  const [inputDockOpen, setInputDockOpen] = useState(false);
  const [inputTab, setInputTab] = useState<MeetingInputTab>("manual");
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [selectedConversationNodeId, setSelectedConversationNodeId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stableStatusLabel = useMemo(
    () => statusLabel(speech.isSupported, speech.isListening),
    [speech.isListening, speech.isSupported],
  );

  const elapsedLabel = useMemo(() => formatReplayTime(now - topicEngine.meetingStartedAt), [now, topicEngine.meetingStartedAt]);
  const organizeMeeting = () => {
    speech.stop();
    topicEngine.flushBuffer();
    setMapMode("summary");
    void topicEngine.organizeMeeting();
  };

  return (
    <>
      <header className="meeting-header">
        <div>
          <p className="eyebrow">会議ダッシュボード</p>
          <h1>{topicEngine.meetingGraph.title}</h1>
        </div>
        <div className="header-metrics">
          <div className="header-metric">
            <span>経過時間</span>
            <strong>{elapsedLabel}</strong>
          </div>
          <div className="header-metric">
            <span>現在の議題</span>
            <strong>{topicEngine.currentTopic?.title ?? "なし"}</strong>
          </div>
          <div className="header-metric">
            <span>接続状態</span>
            <strong>{connectionStatus}</strong>
          </div>
        </div>
      </header>

      <section className="dashboard-grid">
        <div className="graph-column">
          {mapMode === "summary" && topicEngine.meetingSummary ? (
            <MeetingSummaryGraph
              error={topicEngine.meetingSummaryError}
              onBack={() => setMapMode("live")}
              onRefresh={organizeMeeting}
              onRename={topicEngine.renameMeetingSummaryNode}
              onStartIdeaSession={(selectedItemIds) =>
                onStartIdeaSession(topicEngine.meetingSummary!, topicEngine.segmentArchive, selectedItemIds)
              }
              segments={topicEngine.segmentArchive}
              stale={topicEngine.meetingSummaryStale}
              startedAt={topicEngine.meetingSummaryStartedAt}
              status={topicEngine.meetingSummaryStatus}
              summary={topicEngine.meetingSummary}
            />
          ) : (
            <TopicGraph
              conversationTree={topicEngine.conversationTree}
              selectedNodeId={selectedConversationNodeId}
              onRate={topicEngine.toggleConversationNodeRating}
              onSelect={setSelectedConversationNodeId}
            />
          )}
        </div>

        <div className="rail-column meeting-rail">
          <div className="workspace-tabs" role="tablist" aria-label="会議サイドパネル">
            <button
              type="button"
              role="tab"
              aria-selected={railTab === "progress"}
              aria-controls="meeting-progress-panel"
              id="meeting-progress-tab"
              onClick={() => setRailTab("progress")}
            >
              進行
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={railTab === "analysis"}
              aria-controls="meeting-analysis-panel"
              id="meeting-analysis-tab"
              onClick={() => setRailTab("analysis")}
            >
              分析
            </button>
          </div>

          <div
            className="meeting-tab-panel meeting-rail-stack"
            role="tabpanel"
            id="meeting-progress-panel"
            aria-labelledby="meeting-progress-tab"
            hidden={railTab !== "progress"}
          >
            <ConversationNodeEditor
              conversationTree={topicEngine.conversationTree}
              selectedNodeId={selectedConversationNodeId}
              onUpdate={topicEngine.updateConversationNode}
            />
            <ControlPanel
              error={speech.error}
              isListening={speech.isListening}
              isSupported={speech.isSupported}
              onReset={() => setIsResetConfirmOpen(true)}
              onOrganize={organizeMeeting}
              canOrganize={topicEngine.segmentArchive.length > 0}
              isOrganizing={topicEngine.meetingSummaryStatus === "refining"}
              onStart={speech.start}
              onStop={() => {
                speech.stop();
                topicEngine.flushBuffer();
              }}
              statusLabel={stableStatusLabel}
            />
            <TopicInspector
              connectionStatus={connectionStatus}
              currentTopicGaps={topicEngine.currentTopicGaps}
              currentTopicId={topicEngine.currentTopicId}
              decisionLogs={topicEngine.decisionLogs}
              focusState={topicEngine.focusState}
              importantMentions={topicEngine.importantMentions}
              logs={topicEngine.logs}
              meetingGraph={topicEngine.meetingGraph}
              onFocusLockedChange={topicEngine.setFocusLocked}
              onManualFocusChange={topicEngine.setManualFocus}
              segments={topicEngine.segments}
            />
          </div>

          <div
            className="meeting-tab-panel"
            role="tabpanel"
            id="meeting-analysis-panel"
            aria-labelledby="meeting-analysis-tab"
            hidden={railTab !== "analysis"}
          >
            <MeetingReportPanel
              conversationTree={topicEngine.conversationTree}
              importantMentions={topicEngine.importantMentions}
              llmSettings={llmSettings}
              meetingGraph={topicEngine.meetingGraph}
              onUpdateLlmSettings={updateLlmSettings}
              segmentArchive={topicEngine.segmentArchive}
            />
          </div>
        </div>
      </section>

      <section className={`meeting-input-dock ${inputDockOpen ? "is-open" : ""}`} aria-label="入力と再生ツール">
        <button
          type="button"
          className="meeting-input-dock-toggle"
          aria-expanded={inputDockOpen}
          aria-controls="meeting-input-dock-content"
          onClick={() => setInputDockOpen((open) => !open)}
        >
          <span>入力・再生</span>
          <span aria-hidden="true">{inputDockOpen ? "閉じる −" : "開く ＋"}</span>
        </button>
        <div id="meeting-input-dock-content" className="meeting-input-dock-content" hidden={!inputDockOpen}>
          <div className="workspace-tabs input-dock-tabs" role="tablist" aria-label="入力と再生の種類">
            {([
              ["manual", "手入力・シナリオ"],
              ["replay", "ファイル再生"],
              ["transcript", "発話ログ"],
            ] as const).map(([tab, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={inputTab === tab}
                aria-controls={`meeting-input-${tab}-panel`}
                id={`meeting-input-${tab}-tab`}
                key={tab}
                onClick={() => setInputTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="meeting-input-manual-panel" aria-labelledby="meeting-input-manual-tab" hidden={inputTab !== "manual"}>
            <ManualReplayPanel onSubmit={topicEngine.submitTranscript} />
          </div>
          <div role="tabpanel" id="meeting-input-replay-panel" aria-labelledby="meeting-input-replay-tab" hidden={inputTab !== "replay"}>
            <TranscriptReplayPanel onSubmit={topicEngine.submitTimedTranscript} />
          </div>
          <div role="tabpanel" id="meeting-input-transcript-panel" aria-labelledby="meeting-input-transcript-tab" hidden={inputTab !== "transcript"}>
            <TranscriptPanel
              bufferText={topicEngine.bufferText}
              interimText={speech.interimText}
              lastFinalText={speech.lastFinalText}
              meetingGraph={topicEngine.meetingGraph}
              segments={topicEngine.segments}
            />
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="セッションをリセットしますか?"
        description="収集した発言・議題・要約はすべて削除され、元に戻せません。"
        confirmLabel="リセットする"
        onConfirm={() => {
          topicEngine.reset();
          setSelectedConversationNodeId(null);
          setMapMode("live");
          setIsResetConfirmOpen(false);
        }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </>
  );
}
