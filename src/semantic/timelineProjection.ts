// The Timeline as a projection (ADR 0022 §8).
//
// This replaces four architectural defects in ConversationTimeline.tsx rather
// than four separate bugs:
//
//   1. it called classifyUtterance() for every node on every render -- a
//      projection re-interpreting the raw utterances it displays
//   2. it iterated conversationTree.nodes -- a projection stacked on top of
//      another interpretation, so it inherited that interpretation's errors
//   3. corrections lived in component useState -- lost on unmount, invisible to
//      everything else, and not part of the event log
//   4. a correction could only override semanticRole -- per-axis partial
//      override was not expressible
//
// There are no regexes here and no classification. Everything comes from the
// assertions the fast path already produced, resolved against human corrections.

import type {
  CanonicalKind, CanonicalMeetingState, HumanCorrection, InputProviderKind,
  PromotionBasis, SemanticAssertion, SemanticAxes,
} from "./types";
import { canonicalUnitId } from "./canonicalReducer";
import { projectMeetingMinutes } from "./meetingMinutesProjection";
import type { MeetingItem } from "./meetingItem";
import { sliceUnitText } from "./types";
import { resolveUnit, type AxisName } from "./resolveUnit";
import type { MeetingEventLog } from "./rawUtterance";
import { utterancesOf } from "./rawUtterance";

export type TimelineUnitRow = {
  unitId: string;
  text: string;
  axes: SemanticAxes;
  // Axes a person set. Rendered differently from a parser reading.
  humanOverriddenAxes: AxisName[];
  // Axes where the parser disagrees with the person. Shown, never auto-applied.
  conflictingAxes: AxisName[];
  // What this unit became in canonical state, if anything.
  promotion: { kind: CanonicalKind; basis: PromotionBasis } | null;
  item?: MeetingItem;
};

export type TimelineRow = {
  utteranceId: string;
  seq: number;
  createdAt: number;
  speaker: string | null;
  provider: InputProviderKind;
  // The raw wording, which stays the primary source.
  text: string;
  units: TimelineUnitRow[];
  // True when any unit of this utterance carries a human override.
  isCorrected: boolean;
};

export type TimelineProjectionInput = {
  log: MeetingEventLog;
  assertions: SemanticAssertion[];
  corrections: HumanCorrection[];
  canonical: CanonicalMeetingState;
  meetingId?: string;
  minutesItems?: MeetingItem[];
};

export function buildTimelineProjection(input: TimelineProjectionInput): TimelineRow[] {
  const { log, assertions, corrections, canonical } = input;

  const assertionsByUtterance = new Map<string, SemanticAssertion[]>();
  for (const assertion of assertions) {
    const list = assertionsByUtterance.get(assertion.unit.utteranceId) ?? [];
    list.push(assertion);
    assertionsByUtterance.set(assertion.unit.utteranceId, list);
  }

  const entries = new Map(canonical.entries.map((entry) => [canonicalUnitId(entry), entry]));
  const items = new Map((input.minutesItems ?? projectMeetingMinutes(input.meetingId ?? "", canonical, log).items)
    .map((item) => [item.id, item]));

  return utterancesOf(log)
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .map((utterance) => {
      const forUtterance = assertionsByUtterance.get(utterance.id) ?? [];
      // Distinct unit ids, in span order, so a re-asserted unit appears once.
      const unitById = new Map(forUtterance.map((assertion) => [assertion.unit.id, assertion.unit]));
      const unitIds = [...unitById.keys()].sort(
        (left, right) => unitById.get(left)!.span.start - unitById.get(right)!.span.start,
      );
      const units: TimelineUnitRow[] = [];
      for (const unitId of unitIds) {
        const resolved = resolveUnit(unitId, forUtterance, corrections);
        if (!resolved) continue;
        const entry = entries.get(unitId);
        const item = items.get(unitId);
        units.push({
          unitId,
          text: entry?.label ?? sliceUnitText(utterance, unitById.get(unitId)!),
          axes: resolved.axes,
          humanOverriddenAxes: resolved.humanOverriddenAxes,
          conflictingAxes: resolved.conflictingAxes,
          promotion: entry && !entry.disposition && !entry.blocked ? { kind: entry.kind, basis: entry.basis } : null,
          item,
        });
      }

      return {
        utteranceId: utterance.id,
        seq: utterance.seq,
        createdAt: utterance.createdAt,
        speaker: utterance.speaker,
        provider: utterance.provider,
        text: utterance.text,
        units,
        isCorrected: units.some((unit) => unit.humanOverriddenAxes.length > 0 || entries.get(unit.unitId)?.correction),
      };
    });
}
