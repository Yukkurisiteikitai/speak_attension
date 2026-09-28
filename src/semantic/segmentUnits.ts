// Splits one utterance into 0..N unit spans (ADR 0022 §3).
//
// Deliberately under-segments. The rule is *not* "split every sentence": it is
// "split only where an explicit connective marks a relation between clauses."
// That distinction is what keeps these two corpus cases consistent:
//
//   「いい質問ですね。そこはまだ検討中です。青チームで検証します」-> 1 unit
//   「…完了しました。ただし、APIレスポンスが予想より遅くて、…必要があります」-> 3 units
//
// Both contain sentence breaks; only the second marks relations between the
// parts. Splitting on bare 。 would over-segment the first, and every extra unit
// is another chance to promote something that was never a separate claim.
//
// Note on topicExtraction.splitIntoClauses: it is not used here. It discards its
// delimiters (so character offsets cannot be recovered) and it cuts inside
// 「ただし」 on the substring 「ただ」, leaving a 「し、…」 fragment. Spans must map
// back to the raw text exactly, so boundaries are found on the original string.

import type { Span } from "./types";

// Boundary falls *after* the match: the connective belongs to the clause it
// closes. 「〜ので、」 ends a reason; the consequence starts after the comma.
const SPLIT_AFTER_PATTERNS: RegExp[] = [
  /(?:なので|ので|ですから|だから|ため)、/g,
  // Adjective continuative marking cause: 「遅くて、」= "being slow, ...".
  // Narrower than a bare 「て、」 on purpose -- 「決まっていて、」 is not a
  // relation boundary and must stay in one unit.
  /くて、/g,
  /(?:ですが|ますが|だが)、/g,
];

// Boundary falls *before* the match: the connective opens the next clause.
const SPLIT_BEFORE_PATTERNS: RegExp[] = [
  /(?:ただし|但し|しかし|一方で|けれども|けれど|でも)/g,
];

// A contrastive connective only opens a clause when it follows a sentence end,
// a comma, or the start of the utterance. Without this, 「それでも」/「今でも」
// would split mid-word.
function opensClause(text: string, index: number): boolean {
  if (index === 0) return true;
  return /[。．！？!?、,\s]/.test(text[index - 1]);
}

function collectBoundaries(text: string): number[] {
  const boundaries = new Set<number>();

  for (const pattern of SPLIT_AFTER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      boundaries.add(match.index + match[0].length);
    }
  }
  for (const pattern of SPLIT_BEFORE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || !opensClause(text, match.index)) continue;
      boundaries.add(match.index);
    }
  }

  return [...boundaries].filter((offset) => offset > 0 && offset < text.length).sort((a, b) => a - b);
}

// Shrinks a span to its non-whitespace extent so the derived text is clean while
// the offsets still address the raw utterance.
function trimSpan(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

// Half-open, non-overlapping, in document order. An utterance with no content
// yields zero spans -- 0..N includes 0.
export function segmentUnitSpans(text: string): Span[] {
  const whole = trimSpan(text, { start: 0, end: text.length });
  if (!whole) return [];

  const boundaries = collectBoundaries(text);
  if (boundaries.length === 0) return [whole];

  const cuts = [whole.start, ...boundaries.filter((offset) => offset > whole.start && offset < whole.end), whole.end];
  const spans: Span[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const trimmed = trimSpan(text, { start: cuts[index], end: cuts[index + 1] });
    if (trimmed) spans.push(trimmed);
  }
  // Every cut could have been whitespace-only; fall back rather than return [].
  return spans.length > 0 ? spans : [whole];
}
