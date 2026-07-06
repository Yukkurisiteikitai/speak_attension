import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import type { TimedTranscriptSegment } from "../types/topic";
import { importTimedTranscriptJson } from "../utils/transcriptImporter";
import { collectReplaySegments, formatReplayTime, type ReplaySpeed } from "../utils/transcriptReplay";

type TranscriptReplayPanelProps = {
  onSubmit: (segment: TimedTranscriptSegment) => void;
};

const SPEED_OPTIONS: ReplaySpeed[] = [1, 2, 5, "instant"];
const TICK_MS = 100;

function speedLabel(speed: ReplaySpeed): string {
  return speed === "instant" ? "instant" : `${speed}x`;
}

function lastTranscriptTime(segments: TimedTranscriptSegment[]): number {
  return segments.reduce((max, segment) => Math.max(max, segment.endMs ?? segment.startMs), 0);
}

export function TranscriptReplayPanel({ onSubmit }: TranscriptReplayPanelProps) {
  const [segments, setSegments] = useState<TimedTranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [playbackTimeMs, setPlaybackTimeMs] = useState(0);
  const [nextIndex, setNextIndex] = useState(0);
  const [currentSegment, setCurrentSegment] = useState<TimedTranscriptSegment | null>(null);
  const lastTickAtRef = useRef<number | null>(null);
  const nextIndexRef = useRef(0);

  const durationMs = useMemo(() => lastTranscriptTime(segments), [segments]);

  const resetReplay = () => {
    setIsPlaying(false);
    setPlaybackTimeMs(0);
    setNextIndex(0);
    setCurrentSegment(null);
    lastTickAtRef.current = null;
    nextIndexRef.current = 0;
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const importedSegments = importTimedTranscriptJson(await file.text());
      setSegments(importedSegments);
      setError(null);
      resetReplay();
    } catch (err) {
      setSegments([]);
      setError(err instanceof Error ? err.message : "Transcript JSONを読み込めません。");
      resetReplay();
    } finally {
      event.currentTarget.value = "";
    }
  };

  useEffect(() => {
    if (!isPlaying || segments.length === 0) return;

    if (speed === "instant") {
      const result = collectReplaySegments(segments, Number.POSITIVE_INFINITY, nextIndexRef.current);
      result.emittedSegments.forEach(onSubmit);
      setCurrentSegment(result.emittedSegments.at(-1) ?? currentSegment);
      nextIndexRef.current = result.nextIndex;
      setNextIndex(result.nextIndex);
      setPlaybackTimeMs(durationMs);
      setIsPlaying(false);
      lastTickAtRef.current = null;
      return;
    }

    const timer = window.setInterval(() => {
      const now = performance.now();
      const lastTickAt = lastTickAtRef.current ?? now;
      lastTickAtRef.current = now;
      const elapsedMs = now - lastTickAt;

      setPlaybackTimeMs((currentPlaybackTimeMs) => {
        const nextPlaybackTimeMs = Math.min(durationMs, currentPlaybackTimeMs + elapsedMs * speed);
        const result = collectReplaySegments(segments, nextPlaybackTimeMs, nextIndexRef.current);

        if (result.emittedSegments.length > 0) {
          result.emittedSegments.forEach(onSubmit);
          setCurrentSegment(result.emittedSegments.at(-1) ?? null);
          nextIndexRef.current = result.nextIndex;
          setNextIndex(result.nextIndex);
        }

        if (result.nextIndex >= segments.length && nextPlaybackTimeMs >= durationMs) {
          setIsPlaying(false);
          lastTickAtRef.current = null;
        }

        return nextPlaybackTimeMs;
      });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [currentSegment, durationMs, isPlaying, onSubmit, segments, speed]);

  useEffect(() => {
    if (!isPlaying) {
      lastTickAtRef.current = null;
    }
  }, [isPlaying]);

  const canPlay = segments.length > 0 && !error && nextIndex < segments.length;

  return (
    <section className="panel transcript-replay-panel" aria-label="Transcript Replay">
      <div className="section-head">
        <h2>Transcript Replay</h2>
        <span>
          {segments.length}件 / {formatReplayTime(playbackTimeMs)}
        </span>
      </div>

      <label className="field-label" htmlFor="transcriptReplayFile">
        Transcript JSON Import
      </label>
      <input id="transcriptReplayFile" type="file" accept="application/json,.json" onChange={handleFileChange} />

      <div className="replay-meta-grid">
        <div className="segment-buffer">
          <span>現在時刻</span>
          <p>
            {formatReplayTime(playbackTimeMs)} / {formatReplayTime(durationMs)}
          </p>
        </div>
        <div className="segment-buffer">
          <span>再生速度</span>
          <select value={String(speed)} onChange={(event) => setSpeed(event.currentTarget.value === "instant" ? "instant" : Number(event.currentTarget.value) as 1 | 2 | 5)}>
            {SPEED_OPTIONS.map((option) => (
              <option key={String(option)} value={String(option)}>
                {speedLabel(option)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="replay-actions replay-actions-triple">
        <button type="button" onClick={() => setIsPlaying(true)} disabled={!canPlay || isPlaying}>
          <Play size={17} />
          <span>再生</span>
        </button>
        <button type="button" onClick={() => setIsPlaying(false)} disabled={!isPlaying}>
          <Square size={17} />
          <span>停止</span>
        </button>
        <button type="button" onClick={resetReplay} disabled={segments.length === 0 && playbackTimeMs === 0 && nextIndex === 0}>
          <RotateCcw size={17} />
          <span>Reset</span>
        </button>
      </div>

      <div className="live-transcript">
        <span>現在のsegment</span>
        {currentSegment ? (
          <>
            <strong>{currentSegment.speaker ?? "speaker unknown"}</strong>
            <p>{currentSegment.text}</p>
          </>
        ) : (
          <p>Replay待機中</p>
        )}
      </div>

      {error ? <div className="error-message">{error}</div> : null}
    </section>
  );
}
