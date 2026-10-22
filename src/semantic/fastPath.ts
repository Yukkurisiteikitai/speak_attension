// The realtime fast path (ADR 0023 §2, §4).
//
// Runs on a final utterance and nothing else. The signature takes a `context`
// rather than the meeting, so a caller physically cannot hand it the whole
// history: anything needing history belongs on the refinement path.
//
// Only rule-derived assertions, and only relations that an explicit marker
// grounds. Proximity relations are deliberately absent -- inferring cause from
// adjacency is what ADR 0023 §3 moves to refinement (invariant I12).

import type {
  RawUtterance, RelationAssertion, SemanticAssertion, SemanticUnit,
} from "./types";
import { segmentUnitSpans } from "./segmentUnits";
import { parseAxes } from "./parseAxes";

export const FAST_PATH_ENGINE = { engine: "semantic-core/fastPath", version: "1.0.0" } as const;

// The rolling window the fast path may look at. 20 utterances is roughly a few
// minutes of meeting speech -- enough to resolve an explicit named reference
// ("A案") without the cost growing with meeting length.
export const FAST_PATH_CONTEXT_WINDOW = 20;

export type FastPathContext = {
  activeTopicId: string | null;
  // Already limited to FAST_PATH_CONTEXT_WINDOW by the caller.
  recentUtterances: RawUtterance[];
  recentlyReferencedEntityIds: string[];
};

export type FastPathInput = {
  utterance: RawUtterance;
  context: FastPathContext;
};

export type FastPathResult = {
  units: SemanticUnit[];
  assertions: SemanticAssertion[];
  relations: RelationAssertion[];
};

export function emptyFastPathContext(): FastPathContext {
  return { activeTopicId: null, recentUtterances: [], recentlyReferencedEntityIds: [] };
}

// Deterministic ids: the same utterance always yields the same unit ids, so a
// re-run produces comparable assertions instead of a fresh set.
const unitId = (utteranceId: string, index: number) => `${utteranceId}#u${index}`;
const assertionId = (utteranceId: string, index: number) => `${utteranceId}#a${index}`;

// An explicitly named alternative, e.g. 「A案」. The only reference the fast path
// will resolve; pronouns are refinement's job.
const NAMED_OPTION_PATTERN = /[A-Za-zＡ-Ｚａ-ｚ0-9一二三四五]+案/g;

function namedOptionsIn(text: string): string[] {
  return [...new Set(text.match(NAMED_OPTION_PATTERN) ?? [])];
}

export function runFastPath(input: FastPathInput): FastPathResult {
  const { utterance, context } = input;
  const spans = segmentUnitSpans(utterance.text);

  const units: SemanticUnit[] = spans.map((span, index) => ({
    id: unitId(utterance.id, index),
    utteranceId: utterance.id,
    span,
    axes: parseAxes(utterance.text.slice(span.start, span.end)),
  }));

  const assertions: SemanticAssertion[] = units.map((unit, index) => ({
    id: assertionId(utterance.id, index),
    unit,
    // Rule readings are not probabilistic; an explicit marker is held higher
    // than a reading inferred from content words alone.
    confidence: unit.axes.epistemic === "explicit" ? 0.9 : 0.5,
    producedBy: FAST_PATH_ENGINE,
    createdAt: utterance.createdAt,
    supersedes: [],
  }));

  const relations: RelationAssertion[] = [];
  for (const unit of units) {
    const text = utterance.text.slice(unit.span.start, unit.span.end);
    for (const option of namedOptionsIn(text)) {
      // Only link when exactly one earlier utterance in the window names the
      // same alternative. Two candidates is an ambiguity, not a relation.
      const matches = context.recentUtterances.filter(
        (candidate) => candidate.id !== utterance.id && candidate.text.includes(option),
      );
      if (matches.length !== 1) continue;
      relations.push({
        id: `${unit.id}->${matches[0].id}:refines`,
        from: unit.id,
        // The target utterance's first unit; refinement resolves it precisely.
        to: unitId(matches[0].id, 0),
        relation: "refines",
        basis: "named_reference",
        epistemic: "explicit",
        provenance: "rule",
        confidence: 0.8,
        producedBy: FAST_PATH_ENGINE,
      });
    }
  }

  return { units, assertions, relations };
}
