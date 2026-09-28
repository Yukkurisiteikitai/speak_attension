// Assigns the six axes to one unit (ADR 0022 §3).
//
// Each axis is decided from the unit text on its own. No axis reads another
// axis's result, so `role: "decision"` never drags `commitment: "decided"` along
// with it -- promotion, not classification, is what turns a reading into a fact
// (invariant I11).
//
// These patterns are a fresh single definition. They are NOT copied from
// utteranceClassification.ts / conversationTree.ts / meetingDecisionGraph.ts:
// those three hold byte-identical copies of the same rules that have already
// drifted apart (ADR 0022 background), and adding a fourth copy would reproduce
// the defect this migration exists to remove.

import type { Commitment, DiscourseAct, EpistemicStatus, Scope, SemanticAxes, SemanticRole } from "./types";
import { isFillerUtterance } from "../utils/topicExtraction";

// --- markers -----------------------------------------------------------------
// One definition per concept. A marker is an explicit lexical signal; matching
// one is what lets an axis be "explicit" rather than "inferred".

// Managing the meeting itself: setting the agenda, opening/closing, changing
// topic. Beats an artifact name, so 「今日はスライド構成を決めます」 is
// agenda-setting rather than a statement about the slides.
const MEETING_PROCESS_MARKERS = [
  /^(?:今日|本日|今回)(?:は|の|、)?.{0,30}?(?:決めます|決める|確定します|確定する|話します|話す|検討します|議論します|振り返ります|整理したい|やること|議題)/,
  /(?:会議|朝会|定例|ミーティング|打ち合わせ)(?:を)?(?:始め|開始|終わり)/,
  /進捗報告をお願い/,
  /^(?:次に|次の議題|次の話題|話を戻すと|話は変わ|話を変えると|切り替えて|別件)/,
  /^(?:以上です|今日はここまで)/,
  /議題/,
];

// The deliverable being discussed, rather than the subject it is about.
const ARTIFACT_MARKERS = [/スライド/, /資料/, /ドキュメント/, /構成/, /デモ/, /コード/, /ページ/, /章/, /原稿/];

// An explicit choice being closed. Deliberately a closed list of full forms:
// a bare 「します」 ending is NOT here, because that is what currently promotes
// 「パフォーマンステストは本日中に完了します」 (a progress report) into a
// confirmed decision (ADR 0022 background, ADR 0023 §6 gate).
const DECISION_MARKERS = [
  /採用(?:します|する|しました)/,
  /に決め(?:ます|た|ました)/,
  /決定(?:します|した|しました)/,
  /ことにします/,
  /で(?:進めます|いきます|行きます)/,
  /(?:それでいこう|それで行こう)/,
  /見送(?:ります|ります|る)/,
];

// Proposing rather than closing: volitional and suggestion forms.
const PROPOSAL_MARKERS = [
  /(?:ましょう|ませんか)/,
  /(?:したらどう|してはどう|してみては)/,
  /を提案します/,
  /が(?:いい|良い|ベスト)と思い(?:ます|ました)/,
  /必要があります/,
];

const SUPPORT_MARKERS = [/賛成/, /それでいきましょう/, /それで(?:いい|良い)/, /異存(?:は)?(?:ありません|ない)/, /同意します/];
const OPPOSE_MARKERS = [/反対/, /"?賛成できません/, /それは(?:厳しい|難しい)/, /見合いません/, /反対です/];
const DEFER_MARKERS = [/保留/, /後回し/, /次回(?:に|へ)/, /いったん置/, /一旦置/];

// Reporting one's own ongoing deliberation. Must beat the execution markers:
// 「まだ検討中です。青チームで検証します」 is not a decision.
const CONSIDERATION_MARKERS = [/検討(?:中|します|しています)/, /個人的に(?:は)?考えて/, /考えています/, /と思っています/, /検証します/];

// Committing to carry something out. Requires a full execution form at the end
// of the clause, not merely the presence of a verb stem.
const EXECUTION_MARKERS = [
  /(?:作成|対応|確認|実施|提出|修正|準備)(?:します|する|しました)/,
  /(?:やります|出します|進めておきます)/,
];

const OPTION_ENUMERATION_MARKERS = [/(?:候補|選択肢|方法|案)として/, /(?:候補|選択肢)は/];
const AGENDA_ENUMERATION_MARKERS = [/整理したいこと(?:は)?\d+つ/, /整理したいこと/, /やることは/];
const PROBLEM_MARKERS = [/課題/, /問題/, /遅(?:い|くて|さ)/, /困(?:る|って)/, /難しい/, /ボトルネック/, /見合いません/];
const EVIDENCE_MARKERS = [/\d+(?:\.\d+)?%/, /\d+件/, /エラー率/, /エラー/, /\d+秒/];
const CONTEXT_MARKERS = [/ベースは/, /前提として/, /現状(?:は|として)/, /もともと/, /すでに/, /決まっていて/];
const REPORT_MARKERS = [/完了しました/, /終わりました/, /(?:です|ます)$/];

// A wh-word plus か, or an explicit interrogative ending. Mirrors the shape the
// legacy engines converged on, restated once here.
const QUESTION_MARKER = /[?？]|(?:ですか|ますか|でしょうか)$|^(?:なぜ|どうして|どういう|何が|誰が)|(?:何|誰|いつ|どこ|なぜ|どう|どちら|どの).*か$/;

const TOPIC_START_MARKERS = [
  /について(?:決めます|決める|話します|検討します|議論します|相談します)/,
  /^(?:次に|次の議題|次の話題|話を戻すと|話は変わ|別件)/,
  /(?:会議|朝会|定例)(?:を)?始め/,
];

const REFERENCE_MARKERS = [/^それ/, /^これ/, /^その件/, /^この話/, /^さっきの/];

const ACKNOWLEDGEMENT_MAX_LENGTH = 12;

const matchesAny = (patterns: RegExp[], text: string) => patterns.some((pattern) => pattern.test(text));

// --- axes --------------------------------------------------------------------

export function detectScope(text: string): Scope {
  if (!text.trim() || isFillerUtterance(text)) return "unknown";
  // Meeting management is checked first on purpose: an agenda item that names a
  // deliverable is still agenda-setting, and invariant I4 depends on it.
  if (matchesAny(MEETING_PROCESS_MARKERS, text)) return "meeting_process";
  if (matchesAny(ARTIFACT_MARKERS, text)) return "artifact_content";
  if (text.trim().length <= ACKNOWLEDGEMENT_MAX_LENGTH) return "unknown";
  return "subject_matter";
}

export function detectAct(text: string): DiscourseAct {
  if (!text.trim() || isFillerUtterance(text)) return "acknowledge";
  if (QUESTION_MARKER.test(text)) return "ask";
  if (matchesAny(TOPIC_START_MARKERS, text)) return "topic_start";
  if (matchesAny(DEFER_MARKERS, text)) return "defer";
  if (matchesAny(OPPOSE_MARKERS, text)) return "oppose";
  if (matchesAny(SUPPORT_MARKERS, text)) return "advocate";
  // A stated deliberation outranks the execution and decision forms that may
  // also appear in the same clause.
  if (matchesAny(CONSIDERATION_MARKERS, text)) return "report";
  if (matchesAny(DECISION_MARKERS, text)) return "decide";
  if (matchesAny(PROPOSAL_MARKERS, text)) return "suggest";
  if (matchesAny(EXECUTION_MARKERS, text)) return "commit";
  if (matchesAny(OPTION_ENUMERATION_MARKERS, text) || matchesAny(AGENDA_ENUMERATION_MARKERS, text)) return "enumerate";
  if (matchesAny(REPORT_MARKERS, text)) return "report";
  if (text.trim().length <= ACKNOWLEDGEMENT_MAX_LENGTH) return "acknowledge";
  return "other";
}

export function detectRole(text: string): SemanticRole {
  if (!text.trim() || isFillerUtterance(text)) return "acknowledgement";
  if (QUESTION_MARKER.test(text)) return "question";
  if (matchesAny(TOPIC_START_MARKERS, text)) return "topic";
  if (matchesAny(AGENDA_ENUMERATION_MARKERS, text)) return "agenda_item";
  if (matchesAny(DEFER_MARKERS, text)) return "option";
  if (matchesAny(CONTEXT_MARKERS, text)) return "context";
  if (matchesAny(CONSIDERATION_MARKERS, text)) return "option";
  if (matchesAny(DECISION_MARKERS, text)) return "decision";
  if (matchesAny(OPTION_ENUMERATION_MARKERS, text)) return "option";
  if (matchesAny(PROPOSAL_MARKERS, text)) return "proposal";
  if (matchesAny(EXECUTION_MARKERS, text)) return "action";
  if (matchesAny(PROBLEM_MARKERS, text)) return "problem";
  if (matchesAny(EVIDENCE_MARKERS, text)) return "evidence";
  // A clause closed by a causal connective states a reason.
  if (/(?:ので|なので|ため|から|くて)、?$/.test(text.trim())) return "reason";
  if (text.trim().length <= ACKNOWLEDGEMENT_MAX_LENGTH) return "acknowledgement";
  return "other";
}

export function detectCommitment(text: string): Commitment {
  if (!text.trim() || isFillerUtterance(text)) return "none";
  if (QUESTION_MARKER.test(text)) return "none";
  if (matchesAny(TOPIC_START_MARKERS, text)) return "none";
  if (matchesAny(DEFER_MARKERS, text)) return "deferred";
  if (matchesAny(OPPOSE_MARKERS, text)) return "rejected";
  if (matchesAny(SUPPORT_MARKERS, text)) return "accepted";
  // Stated deliberation caps the commitment: an utterance that says it is still
  // being considered cannot simultaneously be decided.
  if (matchesAny(CONSIDERATION_MARKERS, text)) return "considered";
  if (matchesAny(DECISION_MARKERS, text)) return "decided";
  if (matchesAny(PROPOSAL_MARKERS, text)) return "proposed";
  if (matchesAny(EXECUTION_MARKERS, text)) return "committed";
  if (matchesAny(OPTION_ENUMERATION_MARKERS, text)) return "mentioned";
  if (matchesAny(PROBLEM_MARKERS, text) || matchesAny(EVIDENCE_MARKERS, text) || matchesAny(CONTEXT_MARKERS, text)) {
    return "mentioned";
  }
  return "none";
}

// "explicit" needs a marker in the text. Content words alone are "inferred".
// An unresolved leading reference is "ambiguous": we cannot tell what it is
// about, and ADR 0022 §7 says prefer unknown over a false positive.
export function detectEpistemic(text: string): EpistemicStatus {
  const trimmed = text.trim();
  if (!trimmed || isFillerUtterance(trimmed)) return "ambiguous";
  if (matchesAny(REFERENCE_MARKERS, trimmed)) return "ambiguous";
  const hasMarker =
    QUESTION_MARKER.test(trimmed) ||
    matchesAny(TOPIC_START_MARKERS, trimmed) ||
    matchesAny(DECISION_MARKERS, trimmed) ||
    matchesAny(PROPOSAL_MARKERS, trimmed) ||
    matchesAny(EXECUTION_MARKERS, trimmed) ||
    matchesAny(DEFER_MARKERS, trimmed) ||
    matchesAny(SUPPORT_MARKERS, trimmed) ||
    matchesAny(OPPOSE_MARKERS, trimmed) ||
    matchesAny(CONSIDERATION_MARKERS, trimmed) ||
    matchesAny(OPTION_ENUMERATION_MARKERS, trimmed) ||
    matchesAny(AGENDA_ENUMERATION_MARKERS, trimmed);
  if (hasMarker) return "explicit";
  if (trimmed.length <= ACKNOWLEDGEMENT_MAX_LENGTH) return "ambiguous";
  return "inferred";
}

// The realtime parser only ever states rule-derived readings (ADR 0023 §2).
export function parseAxes(text: string): SemanticAxes {
  return {
    scope: detectScope(text),
    role: detectRole(text),
    act: detectAct(text),
    commitment: detectCommitment(text),
    epistemic: detectEpistemic(text),
    provenance: "rule",
  };
}

// --- action details ----------------------------------------------------------

// Single definition, replacing the two divergent copies in
// meetingDecisionGraph.ts and utteranceClassification.ts that disagree on the
// same utterance (ADR 0022 background).
export type ActionDetails = { owner: string | null; deadline: string | null };

export function extractActionDetails(text: string): ActionDetails {
  // 「今まで」 is "until now", not a deadline. The legacy copies fixed this in
  // only one of the two, which is why conversationTree still reads
  // 「私は今までどんな情報が…」 as an action.
  const deadline =
    /(?:今すぐ|直ちに|至急)/.test(text)
      ? "即時"
      : text.match(/(?:今日|明日|明後日|今週|来週|今月|来月|\d+月\d+日|[月火水木金土日]曜日|\d+時)(?:中)?までに?/)?.[0] ?? null;

  // Prefer the name carrying an honorific. Two things are needed to get this
  // right, both found by running the parser over held-out meetings:
  //   - the name must START at a boundary (utterance start, punctuation, or a
  //     particle). A bare negative lookbehind lets the match begin mid-name and
  //     turned 「田中さんと鈴木さんが」 into the owner 「木」.
  //   - particles are excluded from the name itself, so the match does not
  //     swallow the phrase in front of it (「移行の検証は佐藤」).
  // 「と」 is absent from the allowed prefixes, so two owners joined by it yield
  // no owner at all -- no owner is safer than one of two silently winning.
  const NAME = "[^、。\\sとはのをがにでへも]{1,8}";
  const honorific = text.match(new RegExp(`(?:^|[、。\\s]|[はのをにでへも])(${NAME})(?:さん|氏)が`))?.[1] ?? null;
  // Fall back to a bare subject only at a clause boundary, e.g. 「私が金曜日までに」.
  const bareSubject = text.match(new RegExp(`(?:^|[、。\\s])(${NAME})が`))?.[1] ?? null;
  const owner = honorific ?? bareSubject;

  return { owner, deadline: deadline && /^今まで/.test(deadline) ? null : deadline };
}
