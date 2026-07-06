import type { TimedTranscriptSegment, TimedTranscriptWord } from "../types/topic";

const VALID_SOURCES = new Set<TimedTranscriptSegment["source"]>([
  "official_transcript",
  "offline_stt",
  "manual_replay",
  "audio_replay",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseWord(word: unknown, segmentIndex: number, wordIndex: number): TimedTranscriptWord {
  if (!word || typeof word !== "object") {
    throw new Error(`${segmentIndex + 1}件目の words[${wordIndex}] が不正です。`);
  }

  const candidate = word as Record<string, unknown>;
  if (typeof candidate.text !== "string" || candidate.text.trim() === "") {
    throw new Error(`${segmentIndex + 1}件目の words[${wordIndex}] に text がありません。`);
  }
  if (!isFiniteNumber(candidate.startMs)) {
    throw new Error(`${segmentIndex + 1}件目の words[${wordIndex}] の startMs は数値にしてください。`);
  }
  if (!isFiniteNumber(candidate.endMs)) {
    throw new Error(`${segmentIndex + 1}件目の words[${wordIndex}] の endMs は数値にしてください。`);
  }
  if (candidate.confidence !== undefined && !isFiniteNumber(candidate.confidence)) {
    throw new Error(`${segmentIndex + 1}件目の words[${wordIndex}] の confidence は数値にしてください。`);
  }

  return {
    text: candidate.text.trim(),
    startMs: candidate.startMs,
    endMs: candidate.endMs,
    confidence: candidate.confidence,
  };
}

function parseSegment(item: unknown, index: number): TimedTranscriptSegment {
  if (!item || typeof item !== "object") {
    throw new Error(`${index + 1}件目のsegmentがオブジェクトではありません。`);
  }

  const candidate = item as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    throw new Error(`${index + 1}件目の id がありません。`);
  }
  if (!isFiniteNumber(candidate.startMs)) {
    throw new Error(`${index + 1}件目の startMs は数値にしてください。`);
  }
  if (candidate.endMs !== undefined && !isFiniteNumber(candidate.endMs)) {
    throw new Error(`${index + 1}件目の endMs は数値にしてください。`);
  }
  if (typeof candidate.text !== "string" || candidate.text.trim() === "") {
    throw new Error(`${index + 1}件目の text がありません。`);
  }
  if (!VALID_SOURCES.has(candidate.source as TimedTranscriptSegment["source"])) {
    throw new Error(`${index + 1}件目の source が不正です。`);
  }
  if (candidate.speaker !== undefined && typeof candidate.speaker !== "string") {
    throw new Error(`${index + 1}件目の speaker は文字列にしてください。`);
  }
  if (candidate.confidence !== undefined && !isFiniteNumber(candidate.confidence)) {
    throw new Error(`${index + 1}件目の confidence は数値にしてください。`);
  }
  if (candidate.words !== undefined && !Array.isArray(candidate.words)) {
    throw new Error(`${index + 1}件目の words は配列にしてください。`);
  }

  return {
    id: candidate.id.trim(),
    startMs: candidate.startMs,
    endMs: candidate.endMs,
    speaker: candidate.speaker,
    text: candidate.text.trim(),
    source: candidate.source as TimedTranscriptSegment["source"],
    confidence: candidate.confidence,
    words: candidate.words?.map((word, wordIndex) => parseWord(word, index, wordIndex)),
    raw: candidate.raw,
  };
}

export function importTimedTranscriptJson(value: string): TimedTranscriptSegment[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("JSONを解析できません。");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Transcript JSONは配列にしてください。");
  }

  return parsed.map(parseSegment).sort((left, right) => left.startMs - right.startMs);
}
