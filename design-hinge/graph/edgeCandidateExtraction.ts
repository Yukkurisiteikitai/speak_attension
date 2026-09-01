import type { RelationKind } from "./types";

export type EdgeCandidate = {
  sourceLabel: string;
  targetLabel: string;
  relation: RelationKind;
  clause: string;
  reason: string;
};

// Structural analogue of src/utils/topicExtraction.ts's TOPIC_MARKER_PATTERNS,
// but for Japanese causal connectives instead of topic markers. Real-time
// segment processing must stay rule-based (AGENTS.md hard constraint), so no
// LLM ever touches node/edge *creation* — only optional phrasing later
// (see policy/llmPhrasing.ts).
export const CAUSAL_MARKER_PATTERNS: Array<{ regex: RegExp; relation: RelationKind; reason: string }> = [
  { regex: /(.{2,20}?)(?:ので|によって|から)、?(.{2,20}?)(?:になる|になった|が起きる|が起きた|する|した)/, relation: "causes", reason: "marker: ので/によって → causes" },
  { regex: /(.{2,20}?)が(?:なければ|ないと)、?(.{2,20}?)できない/, relation: "blocks", reason: "marker: がなければ…できない → blocks" },
  { regex: /(.{2,20}?)が(?:あれば|あると)、?(.{2,20}?)できる/, relation: "enables", reason: "marker: があれば…できる → enables" },
  { regex: /(.{2,20}?)には(.{2,20}?)が必要/, relation: "depends_on", reason: "marker: には…が必要 → depends_on" },
  { regex: /(.{2,20}?)と思ったが、?(.{2,20})/, relation: "contradicts", reason: "marker: と思ったが → contradicts" },
  { regex: /(.{2,20}?)なのに、?(.{2,20})/, relation: "contradicts", reason: "marker: なのに → contradicts" },
  { regex: /(.{2,20}?)を(.{2,20}?)に変え(?:る|た)/, relation: "transforms", reason: "marker: を…に変える → transforms" },
];

function cleanupLabel(value: string): string {
  return value
    .replace(/^(そして|それで|でも|しかし|また|なので)\s*/g, "")
    .replace(/[、,。.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractEdgeCandidates(text: string): EdgeCandidate[] {
  const candidates: EdgeCandidate[] = [];

  for (const clause of text.split(/[。.!！?？\n]/).map((c) => c.trim()).filter(Boolean)) {
    for (const pattern of CAUSAL_MARKER_PATTERNS) {
      const match = pattern.regex.exec(clause);
      if (!match) continue;
      const sourceLabel = cleanupLabel(match[1] ?? "");
      const targetLabel = cleanupLabel(match[2] ?? "");
      if (!sourceLabel || !targetLabel || sourceLabel === targetLabel) continue;

      candidates.push({ sourceLabel, targetLabel, relation: pattern.relation, clause, reason: pattern.reason });
    }
  }

  return candidates;
}
