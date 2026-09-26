import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ActionView } from "./components/ActionView";
import { ConversationNodeEditor } from "./components/ConversationNodeEditor";
import { ControlPanel } from "./components/ControlPanel";
import { DesignHingePanel } from "./components/DesignHingePanel";
import { IdeaModeView } from "./components/IdeaModeView";
import { ManualReplayPanel } from "./components/ManualReplayPanel";
import { MeetingReportPanel } from "./components/MeetingReportPanel";
import { MeetingSummaryGraph } from "./components/MeetingSummaryGraph";
import { MeetingStateMap } from "./components/MeetingStateMap";
import { MeetingStateDashboard } from "./components/MeetingStateDashboard";
import { MeetingProgressMap } from "./components/MeetingProgressMap";
import { DecisionSupportPanel } from "./components/DecisionSupportPanel";
import { TopicGraph } from "./components/TopicGraph";
import { TopicInspector } from "./components/TopicInspector";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { TranscriptReplayPanel } from "./components/TranscriptReplayPanel";
import { createIdeaSessionStore } from "./hooks/ideaSessionStore";
import { useDesignHingeStore } from "./hooks/useDesignHingeStore";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useLlmSettings } from "./hooks/useLlmSettings";
import { useTopicEngine } from "./hooks/useTopicEngine";
import { createIdeaSessionFromMeetingSelection } from "./utils/ideaSession";
import { buildMeetingStateDashboard } from "./utils/meetingStateDashboard";
import { formatReplayTime } from "./utils/transcriptReplay";
import type { AnalyzedSegment, MeetingSummary, SessionLogEntry } from "./types/topic";

type AppMode = "idea" | "meeting";
type MeetingInputTab = "manual" | "replay" | "transcript";
type MeetingMapMode = "dashboard" | "progress" | "state" | "live" | "summary";

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
  if (!isSupported) return "音声入力は非対応";
  if (isListening) return "音声入力中";
  return "音声入力 待機中";
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("meeting");
  const [meetingVisited, setMeetingVisited] = useState(true);
  const [ideaStore] = useState(() => createIdeaSessionStore());
  const startIdeaSessionFromMeeting = useCallback(
    (summary: MeetingSummary, segments: AnalyzedSegment[], selectedItemIds: string[]) => {
      ideaStore.replaceSession(createIdeaSessionFromMeetingSelection(summary, segments, selectedItemIds));
      setMode("idea");
    },
    [ideaStore],
  );

  return (
    <main className={`app-shell is-${mode}-mode`}>
      <nav className="mode-switch" aria-label="app mode">
        <button type="button" className={mode === "idea" ? "is-active" : ""} onClick={() => setMode("idea")}>
          アイデア出しモード
        </button>
        <button type="button" className={mode === "meeting" ? "is-active" : ""} onClick={() => { setMeetingVisited(true); setMode("meeting"); }}>
          会議モード
        </button>
      </nav>
      {mode === "idea" ? <IdeaModeView store={ideaStore} /> : null}
      {meetingVisited ? <div hidden={mode !== "meeting"}>
        <MeetingMode active={mode === "meeting"} onStartIdeaSession={startIdeaSessionFromMeeting} />
      </div> : null}
    </main>
  );
}

function MeetingMode({
  active,
  onStartIdeaSession,
}: {
  active: boolean;
  onStartIdeaSession: (summary: MeetingSummary, segments: AnalyzedSegment[], selectedItemIds: string[]) => void;
}) {
  const { connectionStatus, sendLog } = useSessionSocket();
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const topicEngine = useTopicEngine({ onLog: sendLog, llmSettings });
  const designHinge = useDesignHingeStore({ llmSettings });
  const speech = useSpeechRecognition({
    onFinalText: (text) => {
      topicEngine.addTranscriptText(text);
      designHinge.ingestUtterance(text, "speech");
    },
  });
  const [now, setNow] = useState(() => Date.now());
  const [mapMode, setMapMode] = useState<MeetingMapMode>("dashboard");
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const dashboard = useMemo(
    () => buildMeetingStateDashboard(topicEngine.decisionGraph, topicEngine.decisionSupport.materials, topicEngine.currentTopic?.title ?? null),
    [topicEngine.decisionGraph, topicEngine.decisionSupport.materials, topicEngine.currentTopic],
  );
  const exploreFromDashboard = useCallback((id: string) => { setSelectedDecisionId(id); setMapMode("state"); }, []);
  const stopSpeech = speech.stop;
  const flushMeeting = topicEngine.flushBuffer;
  useEffect(() => { if (!active) { stopSpeech(); flushMeeting(); } }, [active, stopSpeech, flushMeeting]);
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
          <p className="eyebrow">MEETING WORKSPACE</p>
          <h1>{topicEngine.meetingGraph.title}</h1>
        </div>
        <div className="header-metrics">
          <div className="header-metric">
            <span className={`connection-dot ${speech.isListening ? "is-live" : ""}`} />
            <strong>{speech.isListening ? "録音中" : "待機中"}</strong>
          </div>
          <div className="header-metric"><span>経過</span><strong>{elapsedLabel}</strong></div>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="meeting-agenda-column">
          <section className="meeting-agenda-card">
            <p className="eyebrow">AGENDA</p><h2>会議の状況</h2>
            <div className="agenda-current"><span>現在の議題</span><strong>{topicEngine.currentTopic?.title ?? "議題はまだありません"}</strong></div>
            <div className="agenda-count"><span>記録した発言</span><strong>{topicEngine.segmentArchive.length}</strong><small>件</small></div>
            <div className="agenda-guide"><span className="agenda-guide-step is-current">1</span><div><strong>発言を集める</strong><small>音声またはテキストで追加</small></div></div>
            <div className="agenda-guide"><span className={`agenda-guide-step ${topicEngine.segmentArchive.length ? "is-current" : ""}`}>2</span><div><strong>考えを整理する</strong><small>話題・課題・理由・行動</small></div></div>
            <div className="agenda-guide"><span className={`agenda-guide-step ${topicEngine.discussionPrompts.length ? "is-current" : ""}`}>3</span><div><strong>次の確認へ</strong><small>未解決の点を明らかにする</small></div></div>
            <button type="button" className="quiet-button" onClick={() => setIsResetConfirmOpen(true)}>会議をリセット</button>
          </section>
        </aside>
        <div className={`graph-column ${mapMode === "state" || mapMode === "dashboard" ? "is-state-map" : ""}`}>
          <ControlPanel
            error={speech.error} isListening={speech.isListening} isSupported={speech.isSupported}
            onReset={() => setIsResetConfirmOpen(true)} onOrganize={organizeMeeting}
            canOrganize={topicEngine.segmentArchive.length > 0}
            isOrganizing={topicEngine.meetingSummaryStatus === "refining"}
            onStart={speech.isSupported ? speech.start : () => setInputDockOpen(true)} onStop={() => { speech.stop(); topicEngine.flushBuffer(); }}
            statusLabel={stableStatusLabel}
          />
          {mapMode === "dashboard" ? (
            <MeetingStateDashboard
              currentTopicTitle={dashboard.currentTopicTitle}
              confirmedDecisions={dashboard.confirmedDecisions}
              reasonsByDecisionId={dashboard.reasonsByDecisionId}
              structuralGaps={dashboard.structuralGaps}
              unresolvedItems={dashboard.unresolvedItems}
              aiSuggestedChecks={dashboard.aiSuggestedChecks}
              humanConfirmedChecks={dashboard.humanConfirmedChecks}
              nextActions={dashboard.nextActions}
              now={dashboard.now}
              onExplore={exploreFromDashboard}
              onOpenDecisionSupport={topicEngine.analyzeDecisionSupport}
              onStartReview={() => setMapMode("progress")}
            />
          ) : mapMode === "progress" ? (
            <MeetingProgressMap tree={topicEngine.conversationTree} graph={topicEngine.decisionGraph} segments={topicEngine.segmentArchive}
              meetingReview={topicEngine.meetingReview} onReviewChange={topicEngine.setMeetingReview}
              prompts={topicEngine.discussionPrompts} reviewStatus={topicEngine.progressReviewStatus} reviewError={topicEngine.progressReviewError}
              armedPromptId={topicEngine.armedDiscussionPrompt?.id ?? null} onArmPrompt={topicEngine.armDiscussionPrompt}
              onAnswer={(id, text, needsResearch) => { topicEngine.answerDiscussionPrompt(id, text, needsResearch); designHinge.ingestUtterance(text, "manual"); }}
              onDefer={topicEngine.setDiscussionPromptDeferred} onExplore={(id) => { setSelectedDecisionId(id); setMapMode("state"); }}
              onSubmit={(text) => { topicEngine.submitTranscript(text, "manual"); designHinge.ingestUtterance(text, "manual"); }} onStart={speech.isSupported ? speech.start : () => setInputDockOpen(true)} />
          ) : mapMode === "state" ? (
            <MeetingStateMap graph={topicEngine.decisionGraph} meetingId={topicEngine.meetingGraph.meetingId} title={topicEngine.meetingGraph.title} selectedId={selectedDecisionId} onSelect={setSelectedDecisionId} />
          ) : mapMode === "summary" && topicEngine.meetingSummary ? (
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
              onStart={speech.start}
            />
          )}
          <details className="map-alternatives"><summary>別のマップ・詳細表示</summary><div className="map-alternative-buttons">
            <button aria-pressed={mapMode === "dashboard"} onClick={() => setMapMode("dashboard")}>会議の状況</button>
            <button aria-pressed={mapMode === "progress"} onClick={() => setMapMode("progress")}>流れと次の検討</button>
            <button aria-pressed={mapMode === "state"} onClick={() => setMapMode("state")}>現在状態と根拠</button>
            <button aria-pressed={mapMode === "live"} onClick={() => setMapMode("live")}>会話マップ</button>
            {topicEngine.meetingSummary ? <button aria-pressed={mapMode === "summary"} onClick={() => setMapMode("summary")}>整理マップ</button> : null}
          </div></details>
        </div>

        <div className="rail-column meeting-rail">
          <ActionView graph={topicEngine.decisionGraph} onUpdate={topicEngine.updateAction} onExplore={(id) => { setSelectedDecisionId(id); setMapMode("state"); }} />
          <DecisionSupportPanel analysis={topicEngine.decisionSupport} segments={topicEngine.segmentArchive} onAnalyze={topicEngine.analyzeDecisionSupport} onStatus={topicEngine.updateDecisionMaterialStatus} />
          <details className="secondary-tools"><summary>会話マップの調整</summary><ConversationNodeEditor
              conversationTree={topicEngine.conversationTree}
              selectedNodeId={selectedConversationNodeId}
              onUpdate={topicEngine.updateConversationNode}
          /></details>
          <details className="secondary-tools"><summary>分析・レポート・設定</summary><MeetingReportPanel
              conversationTree={topicEngine.conversationTree}
              importantMentions={topicEngine.importantMentions}
              llmSettings={llmSettings}
              meetingGraph={topicEngine.meetingGraph}
              decisionGraph={topicEngine.decisionGraph}
              onUpdateLlmSettings={updateLlmSettings}
              segmentArchive={topicEngine.segmentArchive}
            /><DesignHingePanel
              activeCard={designHinge.activeCard} graph={designHinge.graph}
              pendingProposals={designHinge.pendingProposals} pendingCandidateQueue={designHinge.pendingCandidateQueue}
              policyEnabled={designHinge.policyEnabled} acceptNodeProposal={designHinge.acceptNodeProposal}
              acceptEdgeProposal={designHinge.acceptEdgeProposal} rejectEdgeProposal={designHinge.rejectEdgeProposal}
              approveIntervention={designHinge.approveIntervention} dismissIntervention={designHinge.dismissIntervention}
              createCounterfactual={designHinge.createCounterfactual} requestManualIntervention={designHinge.requestManualIntervention}
              setPolicyEnabled={designHinge.setPolicyEnabled} exportSession={designHinge.exportSession}
            /><TopicInspector
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
          /></details>
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
            <ManualReplayPanel
              onSubmit={(text, source) => {
                topicEngine.submitTranscript(text, source);
                designHinge.ingestUtterance(text, source);
              }}
            />
          </div>
          <div role="tabpanel" id="meeting-input-replay-panel" aria-labelledby="meeting-input-replay-tab" hidden={inputTab !== "replay"}>
            <TranscriptReplayPanel
              active={active}
              onSubmit={(segment) => {
                topicEngine.submitTimedTranscript(segment);
                designHinge.ingestUtterance(segment.text, "replay");
              }}
            />
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
          designHinge.reset();
          setSelectedConversationNodeId(null);
          setSelectedDecisionId(null);
          setMapMode("dashboard");
          setIsResetConfirmOpen(false);
        }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </>
  );
}
