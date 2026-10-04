// Timeline-only utterance classification (ADR 0021). This is intentionally a
// separate, read-only classifier from the decision graph in
// meetingDecisionGraph.ts: it exists to give the Timeline UI a richer,
// three-axis reading of a single utterance without ever feeding
// confirmedDecisions / nextActions / structuralGaps. Nothing in this file is
// wired into meetingStateDashboard.ts or the decision graph, and it must stay
// that way -- see the "no promotion" test in utteranceClassification.test.ts.
//
// The single "semantic label" that used to describe an utterance conflated
// three different questions:
//   A. what is the utterance about (semanticRole)
//   B. what is the speaker doing with it (discourseAct)
//   C. how confirmed/committed is it (commitment)
// This module separates them, and is deliberately conservative: when nothing
// grounds a stronger reading, it falls back to "acknowledgement" (short) or
// "other" (longer), never forcing a strong role onto an ambiguous utterance.

import { isFillerUtterance } from "./topicExtraction";

export type SemanticRole =
  | "topic"
  | "agenda_item"
  | "context"
  | "problem"
  | "reason"
  | "evidence"
  | "option"
  | "proposal"
  | "decision"
  | "action"
  | "question"
  | "acknowledgement"
  | "other";

export type DiscourseAct =
  | "topic_start"
  | "enumerate"
  | "report"
  | "ask"
  | "suggest"
  | "advocate"
  | "decide"
  | "commit"
  | "acknowledge"
  | "other";

export type Commitment =
  | "none"
  | "mentioned"
  | "considered"
  | "proposed"
  | "accepted"
  | "decided"
  | "committed"
  | "rejected";

// Single source of truth for role labels, shared by SemanticBadge and any
// manual-correction UI so the two never drift apart.
export const semanticRoleLabels: Record<SemanticRole, string> = {
  topic: "話題",
  agenda_item: "議題項目",
  context: "背景・前提",
  problem: "課題",
  reason: "理由",
  evidence: "根拠",
  option: "選択肢",
  proposal: "提案",
  decision: "決定",
  action: "アクション",
  question: "質問",
  acknowledgement: "相づち・短い応答",
  other: "その他",
};

export type UtteranceClassification = {
  semanticRole: SemanticRole;
  discourseAct: DiscourseAct;
  commitment: Commitment;
  owner: string | null;
  deadline: string | null;
};

const ACKNOWLEDGEMENT_MAX_LENGTH = 12;

// A plain "...か" ending only counts as a question when a wh-word appears
// earlier, mirroring the same fix already made in meetingDecisionGraph.ts.
// Also includes predicate questions like "大丈夫か" (is this okay?).
const QUESTION_PATTERN = /[?？]|(?:ですか|ますか|でしょうか)$|^(?:なぜ|どうして|どういう|何が|誰が)|(?:何|誰|いつ|どこ|なぜ|どう|どちら|どの|大丈夫|OK|いい|出来).*か$/;

const TOPIC_START_PATTERN = /について(?:決めます|決める|話します|話す|検討します|検討する|相談します|相談する|確認します|確認する|議論します|議論する|会議を始めます|会議を始める|始めます|始める)|^(?:次に|次の議題|次の話題|別件|話は変わ|話を変えると|切り替えて)/;

const AGENDA_ENUMERATION_PATTERN = /今日|今回.{0,10}(?:整理したい|話したい|確認したい|やること|議題).{0,20}(?:\d+つ|[一二三四五六七八九十]+つ)/;

const CONTEXT_PATTERN = /ベースは|前提として|現状(?:は|として)?|現在は|すでに|もともと|状況としては|背景として/;

// Explicit choice-finalizing verbs only -- not the same as an action's
// execution verb, and narrower than a bare "...します" ending (which would
// also match plain actions like "対応します").
const DECISION_PATTERN = /それでいこう|それで行こう|に決め(?:ます|た)|決定(?:します|した)|で(?:進めます|いきます)|に(?:する|します|しましょう|しようか)/;

// An execution-commit verb, matching meetingDecisionGraph.ts's ACTION_PATTERN
// shape (kept independent on purpose -- see module header). "まで" is
// excluded right after "今" (in both alternatives that use it) so "今まで"
// (until now) isn't mistaken for a deadline marker.
// Note: "お願い" and "頼む" are excluded as they are speech acts, not execution verbs,
// and would otherwise over-match statements like "進捗報告をお願いします".
// Specific handling for owner + deadline + "お願い" is done via extractOwner/deadline.
const ACTION_VERB_PATTERN = /(?:さん|氏|チーム|担当|私|自分|君|くん|ちゃん)(?:が|は).*(?<!今)(?:まで|期限)|(?<!今)(?:まで|期限|締切).*(?:出します|出す|対応|確認|実施|進める|作|取る)|(?:出します|対応します|確認します|実施します|進めます|やります|作ります|作成します|作る|作らない|取ります|取る|取らない)/;

// An explicit evaluative endorsement of one option -- distinct from merely
// reporting that one is "considering" or "thinking about" something.
const ADVOCATE_PATTERN = /が(?:いい|良い|ベスト)と思い(?:ます|ました)|にしたらどうでしょう|で進めるのがいい|を提案します/;

// Reporting one's own ongoing deliberation -- a candidate, not an advocated
// choice and not a committed action.
const PERSONAL_CONSIDERATION_PATTERN = /個人的に(?:は)?考えて|検討しています|考えています|と思っています|たいと思います/;

const OPTION_ENUMERATION_PATTERN = /(?:候補|選択肢|方法|案)として|(?:候補|選択肢)は.{0,40}(?:です|があります)/;

// Mid-sentence causal marker only: a sentence that merely *starts* with
// "だから"/"だからこそ" does not have an antecedent, so it must not be read
// as an established reason (this is a positive requirement from real
// meeting feedback, not a hypothetical).
const REASON_PATTERN = /^(.+?)(?:だから|なので|ため|ので|から)[、,\s]+(.+)$/;

// Benefit/advantage expressions that support a proposal or decision
const BENEFIT_PATTERN = /から(?:参加|アクセス)できる|につながりそう|につながる|が(?:いい|よい|便利|効果的|効率的)|メリット|利点|強み/;

// Conditional proposals: "if we do X", "would be like Y"
const CONDITIONAL_PROPOSAL_PATTERN = /あったら|だったら|したら|ならば|たら|ならば|というのは/;

const PROBLEM_PATTERN = /問題|課題|遅(?:い|さ)|困(?:る|って)|難しい|ボトルネック|少なかった|少ない|不足/;

const EVIDENCE_PATTERN = /(?:\d+(?:\.\d+)?%|\d+件|エラー率|エラー|壊れ|破損|確認され|発生して|増加して)/;

// Excludes "と" from the captured name so "田中さんと鈴木さんが" (two people)
// fails to match cleanly rather than capturing the garbled "田中さんと鈴木" --
// no owner is safer than a corrupted one.
// Also matches names followed by "、" or comma, as in "鈴木くん、来週金曜までに..."
// Note: "。" (sentence end) is not used to avoid cross-sentence contamination.
function extractOwner(text: string): string | null {
  return (
    text.match(/(?:^|[、\s])([^、。\sと]+?)(?:さん|くん|ちゃん|君)?が/)?.[1] ??
    text.match(/(?:^|[、\s])([^、。\sと]+?)(?:さん|くん|ちゃん|君)?[、\s]/)?.[1] ??
    null
  );
}

function extractDeadline(text: string): string | null {
  if (/(?:今すぐ|直ちに|至急)/.test(text)) return "即時";
  return (
    text.match(/(?:来週)?(?:月曜日?|火曜日?|水曜日?|木曜日?|金曜日?|土曜日?|日曜日?)(?:まで|中|の\d+時)?/)?.[0] ??
    text.match(/(?:今日|明日|今週|来週|再来週|今月|来月|\d+月\d+日|\d+時)(?:中|の\d+時)?まで/)?.[0] ??
    null
  );
}

function compact(text: string): string {
  return text.replace(/\s+/g, "").replace(/[。.!！?？]+$/g, "");
}

const emptyResult = (role: SemanticRole, act: DiscourseAct, commitment: Commitment): UtteranceClassification => ({
  semanticRole: role,
  discourseAct: act,
  commitment,
  owner: null,
  deadline: null,
});

export function classifyUtterance(rawText: string): UtteranceClassification {
  const text = rawText.trim();
  const normalized = compact(text);

  if (!normalized || isFillerUtterance(normalized)) {
    return emptyResult("acknowledgement", "acknowledge", "none");
  }
  if (QUESTION_PATTERN.test(text) || QUESTION_PATTERN.test(normalized)) {
    return emptyResult("question", "ask", "none");
  }
  if (TOPIC_START_PATTERN.test(text)) {
    return emptyResult("topic", "topic_start", "none");
  }
  if (AGENDA_ENUMERATION_PATTERN.test(text)) {
    return emptyResult("agenda_item", "enumerate", "none");
  }
  if (CONTEXT_PATTERN.test(text)) {
    return emptyResult("context", "report", "mentioned");
  }
  if (DECISION_PATTERN.test(text)) {
    return emptyResult("decision", "decide", "decided");
  }
  if (ACTION_VERB_PATTERN.test(text)) {
    const owner = extractOwner(text);
    const deadline = extractDeadline(text);
    if (owner || deadline) {
      return { semanticRole: "action", discourseAct: "commit", commitment: "committed", owner, deadline };
    }
    // An execution verb with no grounded owner/deadline is under-specified:
    // fall back to a weaker reading rather than confirm an action.
    return emptyResult("proposal", "advocate", "proposed");
  }
  // Special case: owner + deadline + "お願い" (e.g., "鈴木くん、来週金曜までにプロトタイプお願い")
  if (/お願い/.test(text)) {
    const owner = extractOwner(text);
    const deadline = extractDeadline(text);
    if (owner || deadline) {
      return { semanticRole: "action", discourseAct: "commit", commitment: "committed", owner, deadline };
    }
  }
  if (ADVOCATE_PATTERN.test(text)) {
    return emptyResult("proposal", "advocate", "proposed");
  }
  if (PERSONAL_CONSIDERATION_PATTERN.test(text)) {
    return emptyResult("option", "report", "considered");
  }
  if (CONDITIONAL_PROPOSAL_PATTERN.test(text)) {
    return emptyResult("proposal", "suggest", "proposed");
  }
  if (OPTION_ENUMERATION_PATTERN.test(text)) {
    return emptyResult("option", "enumerate", "mentioned");
  }
  if (BENEFIT_PATTERN.test(text) || REASON_PATTERN.test(text)) {
    return emptyResult("reason", "report", "mentioned");
  }
  if (PROBLEM_PATTERN.test(text)) {
    return emptyResult("problem", "report", "mentioned");
  }
  if (EVIDENCE_PATTERN.test(text)) {
    return emptyResult("evidence", "report", "mentioned");
  }
  if (normalized.length <= ACKNOWLEDGEMENT_MAX_LENGTH) {
    return emptyResult("acknowledgement", "acknowledge", "none");
  }
  return emptyResult("other", "other", "none");
}
