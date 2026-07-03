import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { ManualReplayPanel } from "./components/ManualReplayPanel";
import { TopicGraph } from "./components/TopicGraph";
import { TopicInspector } from "./components/TopicInspector";
import { TranscriptPanel } from "./components/TranscriptPanel";
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

export default function App() {
  const { connectionStatus, sendLog } = useSessionSocket();
  const topicEngine = useTopicEngine({ onLog: sendLog });
  const speech = useSpeechRecognition({ onFinalText: topicEngine.addTranscriptText });

  const stableStatusLabel = useMemo(
    () => statusLabel(speech.isSupported, speech.isListening),
    [speech.isListening, speech.isSupported],
  );

  return (
    <main className="app-shell">
      <div className="left-column">
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
        <TranscriptPanel
          bufferText={topicEngine.bufferText}
          interimText={speech.interimText}
          lastFinalText={speech.lastFinalText}
          nodes={topicEngine.nodes}
          segments={topicEngine.segments}
        />
      </div>

      <TopicGraph currentTopicId={topicEngine.currentTopicId} edges={topicEngine.edges} nodes={topicEngine.nodes} />

      <TopicInspector
        connectionStatus={connectionStatus}
        decisionLogs={topicEngine.decisionLogs}
        focusState={topicEngine.focusState}
        importantMentions={topicEngine.importantMentions}
        logs={topicEngine.logs}
        nodes={topicEngine.nodes}
        onFocusLockedChange={topicEngine.setFocusLocked}
        onManualFocusChange={topicEngine.setManualFocus}
        segments={topicEngine.segments}
      />
    </main>
  );
}
