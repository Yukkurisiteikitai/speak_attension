import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { ManualReplayPanel } from "./components/ManualReplayPanel";
import { TopicGraph } from "./components/TopicGraph";
import { TopicInspector } from "./components/TopicInspector";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { TranscriptReplayPanel } from "./components/TranscriptReplayPanel";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useTopicEngine } from "./hooks/useTopicEngine";
import type { SessionLogEntry } from "./types/topic";

const WS_URL = "ws://127.0.0.1:8787";

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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function App() {
  const { connectionStatus, sendLog } = useSessionSocket();
  const topicEngine = useTopicEngine({ onLog: sendLog });
  const speech = useSpeechRecognition({ onFinalText: topicEngine.addTranscriptText });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stableStatusLabel = useMemo(
    () => statusLabel(speech.isSupported, speech.isListening),
    [speech.isListening, speech.isSupported],
  );

  const elapsedLabel = useMemo(() => formatElapsed(now - topicEngine.meetingStartedAt), [now, topicEngine.meetingStartedAt]);

  return (
    <main className="app-shell">
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
          <TopicGraph currentTopicId={topicEngine.currentTopicId} edges={topicEngine.edges} nodes={topicEngine.nodes} />
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
          onReset={topicEngine.reset}
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
      </section>
    </main>
  );
}
