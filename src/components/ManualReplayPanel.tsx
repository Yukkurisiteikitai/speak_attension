import { useEffect, useMemo, useState } from "react";
import { Play, Send, StepForward, Square } from "lucide-react";
import type { TranscriptInputSource } from "../types/topic";

type ReplayItem = {
  text: string;
};

type ManualReplayPanelProps = {
  onSubmit: (text: string, source: Exclude<TranscriptInputSource, "speech">) => void;
};

const DEFAULT_SCENARIO = JSON.stringify(
  [
    { text: "今日は採用フローの短縮について決めます" },
    { text: "候補者連絡の遅さが問題です" },
    { text: "理由は担当が曖昧だからです" },
    { text: "佐藤さんが金曜までに改善案を出します" },
    { text: "ただ、別案も見た方がいいです" },
    { text: "そうですね" },
  ],
  null,
  2,
);

function parseScenario(value: string): ReplayItem[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("JSONは配列にしてください。");

  return parsed.map((item, index) => {
    if (typeof item === "string") return { text: item };
    if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
      return { text: item.text };
    }
    throw new Error(`${index + 1}件目に text がありません。`);
  });
}

export function ManualReplayPanel({ onSubmit }: ManualReplayPanelProps) {
  const [manualText, setManualText] = useState("");
  const [scenarioText, setScenarioText] = useState(DEFAULT_SCENARIO);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const scenario = useMemo(() => {
    try {
      const items = parseScenario(scenarioText);
      return { items, error: null };
    } catch (err) {
      return { items: [] as ReplayItem[], error: err instanceof Error ? err.message : "JSONを解析できません。" };
    }
  }, [scenarioText]);

  const submitManual = () => {
    const text = manualText.trim();
    if (!text) return;
    onSubmit(text, "manual");
    setManualText("");
  };

  const submitNextReplay = () => {
    if (scenario.error) {
      setError(scenario.error);
      setIsPlaying(false);
      return;
    }
    const item = scenario.items[cursor];
    if (!item) {
      setIsPlaying(false);
      return;
    }
    onSubmit(item.text, "replay");
    setCursor((current) => current + 1);
    setError(null);
  };

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(submitNextReplay, 1500);
    return () => window.clearInterval(timer);
  }, [isPlaying, scenario.items, scenario.error, cursor]);

  useEffect(() => {
    setCursor(0);
    setIsPlaying(false);
  }, [scenarioText]);

  return (
    <section className="panel manual-replay-panel" aria-label="テスト入力">
      <div className="section-head">
        <h2>Manual / Replay</h2>
        <span>
          {cursor}/{scenario.items.length}
        </span>
      </div>

      <label className="field-label" htmlFor="manualText">
        手動発話
      </label>
      <div className="manual-input-row">
        <textarea
          id="manualText"
          rows={3}
          value={manualText}
          onChange={(event) => setManualText(event.target.value)}
          placeholder="例: それで、さっきの話のレイテンシが問題です"
        />
        <button className="icon-button" type="button" onClick={submitManual} aria-label="手動発話を投入">
          <Send size={18} />
        </button>
      </div>

      <label className="field-label" htmlFor="scenarioText">
        Replay JSON
      </label>
      <textarea
        id="scenarioText"
        className="scenario-textarea"
        rows={8}
        value={scenarioText}
        onChange={(event) => setScenarioText(event.target.value)}
        spellCheck={false}
      />

      <div className="replay-actions">
        <button type="button" onClick={submitNextReplay} disabled={Boolean(scenario.error) || cursor >= scenario.items.length}>
          <StepForward size={17} />
          <span>1件投入</span>
        </button>
        <button
          type="button"
          onClick={() => setIsPlaying((current) => !current)}
          disabled={Boolean(scenario.error) || cursor >= scenario.items.length}
        >
          {isPlaying ? <Square size={17} /> : <Play size={17} />}
          <span>{isPlaying ? "停止" : "自動再生"}</span>
        </button>
      </div>

      {scenario.error || error ? <div className="error-message">{scenario.error ?? error}</div> : null}
    </section>
  );
}
