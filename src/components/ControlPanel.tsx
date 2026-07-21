import { Mic, RefreshCw, Sparkles, Square } from "lucide-react";

type ControlPanelProps = {
  error: string | null;
  isListening: boolean;
  isSupported: boolean;
  onReset: () => void;
  onOrganize: () => void;
  canOrganize: boolean;
  isOrganizing: boolean;
  onStart: () => void;
  onStop: () => void;
  statusLabel: string;
};

export function ControlPanel({
  error,
  isListening,
  isSupported,
  onReset,
  onOrganize,
  canOrganize,
  isOrganizing,
  onStart,
  onStop,
  statusLabel,
}: ControlPanelProps) {
  return (
    <section className="panel control-panel" aria-label="meeting controls">
      <div className="panel-heading">
        <p className="eyebrow">Meeting Controls</p>
        <h2>会議の進行</h2>
        <p className="panel-copy">音声入力を操作し、必要なタイミングで会議を整理します。</p>
      </div>

      <div className="control-row">
        <button className="primary-button" type="button" onClick={isListening ? onStop : onStart} disabled={!isSupported}>
          {isListening ? <Square size={18} /> : <Mic size={18} />}
          <span>{isListening ? "マイク停止" : "マイク開始"}</span>
        </button>
        <button className="icon-button" type="button" onClick={onReset} aria-label="セッションをリセット">
          <RefreshCw size={18} />
        </button>
      </div>

      <button className="primary-button organize-button" type="button" onClick={onOrganize} disabled={!canOrganize || isOrganizing}>
        <Sparkles size={18} />
        <span>{isOrganizing ? "会議を整理中…" : "会議を整理"}</span>
      </button>

      <div className={`status-pill ${isListening ? "active" : ""}`}>{statusLabel}</div>
      {error ? <div className="error-message">{error}</div> : null}
    </section>
  );
}
