// Phase 3 (first slice): a read-only projection of Canonical State into the
// buckets the Meeting State needs (ADR 0022 §6, design doc §5).
//
// Pure and side-effect free. It only groups entries that promotionPolicy has
// already admitted, so it cannot create a decision or an action on its own.
// Nothing in the UI reads this yet; the meetingState flag stays off.

import type { CanonicalEntry, CanonicalKind, CanonicalMeetingState } from "./types";
import { entriesOfKind } from "./canonicalReducer";

export type MeetingStateProjection = {
  // Confirmed in the sense of ADR 0022 §6: explicit marker or human confirmation.
  // Provisional entries are never placed here (I6).
  confirmedDecisions: CanonicalEntry[];
  // Decision entries that are only provisional. Kept visible, never shown as decided.
  provisionalDecisions: CanonicalEntry[];
  actions: CanonicalEntry[];
  deferred: CanonicalEntry[];
  questions: CanonicalEntry[];
  unresolved: CanonicalEntry[];
  // Proposals, options and problems are shown as "not yet decided" material (I1, I2).
  proposals: CanonicalEntry[];
  options: CanonicalEntry[];
  problems: CanonicalEntry[];
  topics: CanonicalEntry[];
  context: CanonicalEntry[];
};

const SUPPORTED_KINDS: readonly CanonicalKind[] = [
  "topic", "context", "problem", "option", "proposal",
  "decision", "action", "deferred", "question", "unresolved",
];

export function projectMeetingState(state: CanonicalMeetingState): MeetingStateProjection {
  const decisions = entriesOfKind(state, "decision");

  return {
    confirmedDecisions: decisions.filter((entry) => entry.basis !== "provisional"),
    provisionalDecisions: decisions.filter((entry) => entry.basis === "provisional"),
    actions: entriesOfKind(state, "action"),
    deferred: entriesOfKind(state, "deferred"),
    questions: entriesOfKind(state, "question"),
    unresolved: entriesOfKind(state, "unresolved"),
    proposals: entriesOfKind(state, "proposal"),
    options: entriesOfKind(state, "option"),
    problems: entriesOfKind(state, "problem"),
    topics: entriesOfKind(state, "topic"),
    context: entriesOfKind(state, "context"),
  };
}

// Every CanonicalKind must be read by the projection. The test suite checks this
// list against the union in types.ts, so a new kind fails until it is handled here.
export const PROJECTED_KINDS: readonly CanonicalKind[] = SUPPORTED_KINDS;
