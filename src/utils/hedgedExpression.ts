// Detects speculation / possibility ("落ちるかもしれません", "おそれがある") so a
// guess is never treated as a confirmed fact. Rule-based and pure.

// Polite and plain endings are folded together so one vocabulary covers both.
function normalizeEnding(text: string): string {
  return text.replace(/思います/g, "思う").replace(/ません/g, "ない").replace(/ます/g, "る");
}

// Stems of events that are bad outcomes when they happen.
const BAD_OUTCOME_STEMS = "落ち|壊れ|遅れ|止まり|止まっ|詰まり|消え|漏れ|失敗し";
// "不足" is a shortfall in what is known (a problem), not an outcome, so it is not listed.
const BAD_OUTCOME_PATTERN = new RegExp(`(?:${BAD_OUTCOME_STEMS}|止まる|詰まる|失敗|エラー|間に合わな|できなくな|障害|破損)`);

const HEDGED_PATTERN = new RegExp(
  [
    "かもしれない",
    "かも(?=[ねよな]|$)",
    "可能性",
    "考えられる",
    "おそれ",
    "恐れ(?=が|は)",
    "のでは",
    "かと(?:思う)?$",
    // "いいと思う" is the speaker's evaluation, not a hedge about a fact.
    "(?<!(?:いい|良い))と思う",
    "としたら",
    "場合は",
    "(?:たぶん|多分|おそらく|恐らく)",
    `(?:${BAD_OUTCOME_STEMS})そう`,
  ].join("|"),
);

export function isHedged(text: string): boolean {
  return HEDGED_PATTERN.test(normalizeEnding(text));
}

// A bad result of something (server down, delay, breakage), as opposed to a
// shortfall in what is known.
export function describesBadOutcome(text: string): boolean {
  return BAD_OUTCOME_PATTERN.test(text);
}

// A bad-outcome or problem word that is directly negated ("落ちない", "問題なく",
// "壊れる心配はありません"). Only the word plus a short fixed continuation is
// read, so an unrelated "ない" later in the clause does not count. A negated
// event is left unclassified rather than guessed at.
const NEGATED_EVENT_PATTERN = new RegExp(
  `(?:${BAD_OUTCOME_STEMS}|問題|課題|障害|破損|エラー|不具合)(?:る|た|ている)?(?:こと|心配|おそれ|恐れ|可能性|懸念)?[はもがを]?(?:あり)?(?:ない|なく|ず)`,
);

export function isNegatedEvent(text: string): boolean {
  // "かもしれない" is a hedge, not a negation.
  return NEGATED_EVENT_PATTERN.test(normalizeEnding(text).replace(/かもしれない/g, "かも"));
}
