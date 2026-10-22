import type { DiscussionPrompt } from "./meetingProgress";

export type MeetingReview = {
  phase: "discussion" | "review" | "final" | "complete";
  deadline: number | null;
  confirmations: string[];
};
export const finalReviewQuestions = [
  "決定したこと・変更したことと、その理由を振り返ってください。",
  "決定・担当・期限について認識のずれ、異論、見落とした前提はありませんか？",
  "未回答・保留の項目について、次に確認する人・期限・再開条件は決まりましたか？",
];
export function initialMeetingReview(): MeetingReview {
  return { phase: "discussion", deadline: null, confirmations: ["", "", ""] };
}
// Reserve two minutes for shared understanding and handover; allow one minute per question.
export function planMeetingReview(prompts: DiscussionPrompt[], remainingSeconds: number) {
  const priority: Record<string, number> = { verify: 0, unresolved_question: 0, missing_decision: 1, goal: 1, missing_owner: 2, missing_due_date: 2, followup: 3, missing_reason: 4, compare: 5 };
  const ranked = prompts.filter((p) => p.status === "open").map((prompt, index) => ({ prompt, index }))
    .sort((a, b) => (priority[a.prompt.kind] ?? 4) - (priority[b.prompt.kind] ?? 4) || a.index - b.index).map(({ prompt }) => prompt);
  const capacity = Number.isFinite(remainingSeconds) ? Math.max(0, Math.floor((remainingSeconds - 120) / 60)) : 0;
  return { selected: ranked.slice(0, capacity), carryover: [...ranked.slice(capacity), ...prompts.filter((p) => p.status === "deferred")] };
}
