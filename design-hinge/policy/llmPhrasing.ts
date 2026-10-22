import { extractJsonObject, requestChat, type ChatMessage, type LlmSettings } from "../../src/utils/llmClient";
import type { TriggerType } from "./types";

export type PhrasingCandidate = {
  candidateId: string;
  triggerType: TriggerType;
  templateQuestion: string;
  context: string;
};

export type PhrasingResult = {
  candidateId: string;
  questionText: string;
};

const PHRASING_SYSTEM_PROMPT = [
  "あなたは音声ブレストの補助AIです。",
  "各候補には、ルールベースで機械的に組み立てた質問文と、その根拠となった文脈があります。",
  "質問の意図と対象は変えず、日本語として自然で簡潔な一文に言い換えてください。",
  "必ず次のJSONのみを出力してください:",
  '{"phrasings":[{"id":"...","question":"..."}]}',
  "ルール: 1文のみ、40字以内、日本語。新しい主張や事実を付け加えない。idは与えられたものをそのまま使う。",
].join("\n");

export function buildPhrasingPrompt(candidates: PhrasingCandidate[]): string {
  const lines: string[] = [];
  for (const candidate of candidates) {
    lines.push(`## 候補ID: ${candidate.candidateId}`);
    lines.push(`種類: ${candidate.triggerType}`);
    lines.push(`ルールベースの質問文: ${candidate.templateQuestion}`);
    lines.push(`文脈: ${candidate.context || "(文脈情報なし)"}`);
    lines.push("");
  }
  return lines.join("\n");
}

type RawPhrasingResponse = {
  phrasings?: Array<{ id?: unknown; question?: unknown }>;
};

export function parsePhrasingResponse(raw: string, validIds: Set<string>): PhrasingResult[] {
  const payload = extractJsonObject(raw) as RawPhrasingResponse;
  if (!Array.isArray(payload.phrasings)) {
    throw new Error("LLM応答にphrasings配列がありません。");
  }

  const results: PhrasingResult[] = [];
  for (const entry of payload.phrasings) {
    if (typeof entry.id !== "string" || !validIds.has(entry.id)) continue;
    if (typeof entry.question !== "string" || entry.question.trim() === "") continue;
    results.push({ candidateId: entry.id, questionText: entry.question.trim() });
  }

  if (results.length === 0) {
    throw new Error("LLM応答から有効な言い換えを作れませんでした。");
  }
  return results;
}

// Async, best-effort only — mirrors src/hooks/topicEngineStore.ts's shape:
// the template question has already shipped synchronously (phraseTemplates.ts)
// before this ever runs, so a failure here just means the template stays,
// never a blocked or missing card. Never touches node/edge creation, only
// the wording of a question already decided by the rule-based Policy Engine.
export async function refinePhrasingWithLlm(
  settings: LlmSettings,
  candidates: PhrasingCandidate[],
  chat: (settings: LlmSettings, messages: ChatMessage[]) => Promise<string> = requestChat,
): Promise<PhrasingResult[]> {
  if (candidates.length === 0) return [];
  const raw = await chat(settings, [
    { role: "system", content: PHRASING_SYSTEM_PROMPT },
    { role: "user", content: buildPhrasingPrompt(candidates) },
  ]);
  return parsePhrasingResponse(raw, new Set(candidates.map((c) => c.candidateId)));
}
