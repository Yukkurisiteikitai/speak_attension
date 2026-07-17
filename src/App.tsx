import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { IdeaModeView } from "./components/IdeaModeView";
import { ManualReplayPanel } from "./components/ManualReplayPanel";
import { MeetingReportPanel } from "./components/MeetingReportPanel";
import { MeetingSummaryGraph } from "./components/MeetingSummaryGraph";
import { TopicGraph } from "./components/TopicGraph";
import { TopicInspector } from "./components/TopicInspector";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { TranscriptReplayPanel } from "./components/TranscriptReplayPanel";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useLlmSettings } from "./hooks/useLlmSettings";
import { useTopicEngine } from "./hooks/useTopicEngine";
import { formatReplayTime } from "./utils/transcriptReplay";
import type { SessionLogEntry } from "./types/topic";

type AppMode = "idea" | "meeting";

const WS_URL = "ws://127.0.0.1:8787";

// Keeps a single browser WebSocket for session logs and hides the transport detail from the UI.
function useSessionSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("ws: connecting");

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.addEventListener("open", () => setConnectionStatus("ws: connected"));
    socket.addEventListener("close", () => setConnectionStatus("ws: disconnected"));
    socket.addEventListener("error", () => setConnectionStatus("ws: error"));

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
  if (!isSupported) return "Web Speech API unavailable";
  if (isListening) return "listening: ja-JP";
  return "idle";
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("idea");

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
      {mode === "idea" ? <IdeaModeView /> : <MeetingMode />}
    </main>
  );
}

function MeetingMode() {
  const { connectionStatus, sendLog } = useSessionSocket();
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const topicEngine = useTopicEngine({ onLog: sendLog, llmSettings });
  const speech = useSpeechRecognition({ onFinalText: topicEngine.addTranscriptText });
  const [now, setNow] = useState(() => Date.now());
  const [mapMode, setMapMode] = useState<"live" | "summary">("live");

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
          <p className="eyebrow">Meeting Dashboard</p>
          <h1>{topicEngine.meetingGraph.title}</h1>
        </div>
        <div className="header-metrics">
          <div className="header-metric">
            <span>elapsed</span>
            <strong>{elapsedLabel}</strong>
          </div>
          <div className="header-metric">
            <span>current topic</span>
            <strong>{topicEngine.currentTopic?.title ?? "none"}</strong>
          </div>
          <div className="header-metric">
            <span>status</span>
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
              segments={topicEngine.segmentArchive}
              stale={topicEngine.meetingSummaryStale}
              startedAt={topicEngine.meetingSummaryStartedAt}
              status={topicEngine.meetingSummaryStatus}
              summary={topicEngine.meetingSummary}
            />
          ) : (
            <TopicGraph currentTopicId={topicEngine.currentTopicId} meetingGraph={topicEngine.meetingGraph} segments={topicEngine.segmentArchive} />
          )}
        </div>

        <div className="rail-column">
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
      </section>

      <section className="utility-grid">
        <ControlPanel
          error={speech.error}
          isListening={speech.isListening}
          isSupported={speech.isSupported}
          onReset={() => {
            topicEngine.reset();
            setMapMode("live");
          }}
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
        <ManualReplayPanel onSubmit={topicEngine.submitTranscript} />
        <TranscriptReplayPanel onSubmit={topicEngine.submitTimedTranscript} />
        <TranscriptPanel
          bufferText={topicEngine.bufferText}
          interimText={speech.interimText}
          lastFinalText={speech.lastFinalText}
          meetingGraph={topicEngine.meetingGraph}
          segments={topicEngine.segments}
        />
        <MeetingReportPanel
          importantMentions={topicEngine.importantMentions}
          llmSettings={llmSettings}
          meetingGraph={topicEngine.meetingGraph}
          onUpdateLlmSettings={updateLlmSettings}
          segmentArchive={topicEngine.segmentArchive}
        />
      </section>
    </>
  );
}
