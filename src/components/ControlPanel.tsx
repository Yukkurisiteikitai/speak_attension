import { Mic, RefreshCw, Square } from "lucide-react";

type ControlPanelProps = {
  error: string | null;
  isListening: boolean;
  isSupported: boolean;
  onReset: () => void;
  onStart: () => void;
  onStop: () => void;
  statusLabel: string;
};

export function ControlPanel({
  error,
  isListening,
  isSupported,
  onReset,
  onStart,
  onStop,
  statusLabel,
}: ControlPanelProps) {
  return (
    <section className="panel control-panel" aria-label="音声入力操作">
      <div className="panel-heading">
        <p className="eyebrow">Live Topic Graph</p>
        <h1>会話に合わせて議題ノードを動かす</h1>
      </div>

      <div className="control-row">
        <button className="primary-button" type="button" onClick={isListening ? onStop : onStart} disabled={!isSupported}>
          {isListening ? <Square size={18} /> : <Mic size={18} />}
          <span>{isListening ? "停止" : "マイク開始"}</span>
        </button>
        <button className="icon-button" type="button" onClick={onReset} aria-label="セッションをリセット">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className={`status-pill ${isListening ? "active" : ""}`}>{statusLabel}</div>
      {error ? <div className="error-message">{error}</div> : null}
    </section>
  );
}
