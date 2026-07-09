import type { TopicGapSeverity } from "../types/topic";
import { extractJsonObject, requestChat, type ChatMessage, type LlmSettings } from "./llmClient";
import type { LlmFindingReview, MeetingReport, MeetingReportFinding } from "./meetingReport";

export type LlmReviewResult = {
  findings: MeetingReportFinding[];
  reviewedGroupCount: number;
  errors: string[];
};

type ParsedGapReview = {
  reviews: Map<string, LlmFindingReview>;
  additional: Array<{ title: string; detail: string; severity: TopicGapSeverity }>;
};

type FindingGroup = {
  topicId: string | null;
  topicTitle: string | null;
  findings: MeetingReportFinding[];
};

const SYSTEM_PROMPT = [
  "あなたは会議ファシリテーションの補助AIです。",
  "ルールベース検出器が出した「会議の抜け漏れ」候補を、発言の証拠に基づいて検証します。",
  "各候補について、証拠から見て指摘が妥当なら confirm、的外れやノイズなら drop と判定してください。",
  "証拠にあるのにルールが見落とした抜け漏れがあれば additional に追加してください。確信がない場合は追加しないでください。",
  '必ず次の形式のJSONのみで回答してください: {"findings": [{"id": "...", "verdict": "confirm" | "drop", "reason": "..."}], "additional": [{"title": "...", "detail": "...", "severity": "high" | "medium" | "low"}]}',
].join("\n");

export function buildGapReviewPrompt(group: FindingGroup): string {
  const lines: string[] = [];
  lines.push(`対象トピック: ${group.topicTitle ?? "(特定トピックに紐付かない発言)"}`);
  lines.push("");
  lines.push("## 発言の証拠");
  const evidence = [...new Set(group.findings.flatMap((finding) => finding.evidence))];
  if (evidence.length === 0) {
    lines.push("(証拠となる発言は記録されていません)");
  } else {
    evidence.forEach((text) => lines.push(`- ${text}`));
  }
  lines.push("");
  lines.push("## 検証対象の抜け漏れ候補");
  group.findings.forEach((finding) => {
    lines.push(`- id: ${finding.id} / ${finding.title}: ${finding.detail}`);
  });
  return lines.join("\n");
}

function isVerdict(value: unknown): value is LlmFindingReview["verdict"] {
  return value === "confirm" || value === "drop";
}

function isSeverity(value: unknown): value is TopicGapSeverity {
  return value === "high" || value === "medium" || value === "low";
}

export function parseGapReviewResponse(raw: string, validFindingIds: Set<string>): ParsedGapReview {
  const payload = extractJsonObject(raw) as {
    findings?: Array<{ id?: unknown; verdict?: unknown; reason?: unknown }>;
    additional?: Array<{ title?: unknown; detail?: unknown; severity?: unknown }>;
  };

  const reviews = new Map<string, LlmFindingReview>();
  for (const entry of payload.findings ?? []) {
    if (typeof entry.id !== "string" || !validFindingIds.has(entry.id) || !isVerdict(entry.verdict)) continue;
    reviews.set(entry.id, {
      verdict: entry.verdict,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }

  const additional: ParsedGapReview["additional"] = [];
  for (const entry of payload.additional ?? []) {
    if (typeof entry.title !== "string" || entry.title.trim() === "") continue;
    additional.push({
      title: entry.title,
      detail: typeof entry.detail === "string" ? entry.detail : "",
      severity: isSeverity(entry.severity) ? entry.severity : "medium",
    });
  }

  return { reviews, additional };
}

function groupFindings(findings: MeetingReportFinding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const finding of findings) {
    if (finding.kind === "llm_added") continue;
    const key = finding.topicId ?? "__unassigned__";
    const group = groups.get(key) ?? { topicId: finding.topicId, topicTitle: finding.topicTitle, findings: [] };
    group.findings.push(finding);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Runs the local-LLM second opinion over the rule-based findings, one request per
// topic group. Requests run sequentially because local servers handle one
// generation at a time; a failed group keeps its rule-based findings untouched.
export async function reviewReportWithLlm(
  report: MeetingReport,
  settings: LlmSettings,
  chat: (settings: LlmSettings, messages: ChatMessage[]) => Promise<string> = requestChat,
): Promise<LlmReviewResult> {
  const groups = groupFindings(report.findings);
  const reviewsById = new Map<string, LlmFindingReview>();
  const addedFindings: MeetingReportFinding[] = [];
  const errors: string[] = [];
  let reviewedGroupCount = 0;

  for (const group of groups) {
    const groupLabel = group.topicTitle ?? "トピック未紐付";
    try {
      const raw = await chat(settings, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildGapReviewPrompt(group) },
      ]);
      const parsed = parseGapReviewResponse(raw, new Set(group.findings.map((finding) => finding.id)));
      parsed.reviews.forEach((review, id) => reviewsById.set(id, review));
      parsed.additional.forEach((entry, index) => {
        addedFindings.push({
          id: `llm-${group.topicId ?? "unassigned"}-${index}`,
          kind: "llm_added",
          gapType: null,
          topicId: group.topicId,
          topicTitle: group.topicTitle,
          severity: entry.severity,
          title: entry.title,
          detail: entry.detail,
          evidence: [],
          llm: { verdict: "confirm", reason: "LLMが追加で検出した抜け漏れです。" },
        });
      });
      reviewedGroupCount += 1;
    } catch (error) {
      errors.push(`${groupLabel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const findings = report.findings.map((finding) => {
    const review = reviewsById.get(finding.id);
    return review ? { ...finding, llm: review } : finding;
  });

  return {
    findings: [...findings, ...addedFindings],
    reviewedGroupCount,
    errors,
  };
}
