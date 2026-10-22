// Incremental canonical state (ADR 0023 §5).
//
// Never rebuilds from scratch: an event touches the entries derived from the
// utterances it mentions, and reports which entry ids changed so a projection
// can update selectively. The legacy path rebuilt the whole dashboard on every
// render, which is the quadratic cost the benchmark shows.
//
// This reducer does not decide what gets promoted. It calls promoteUnit and
// nothing else, so the number of places that can admit a decision stays at one.

import type {
  CanonicalEntry, CanonicalKind, CanonicalMeetingState, EntityId, ReduceResult, SemanticEvent,
} from "./types";
import { promoteUnit, PROMOTION_POLICY_VERSION, type PromotionCandidate } from "./promotionPolicy";
import { sliceUnitText } from "./types";

const EMPTY_BY_KIND = (): Record<CanonicalKind, EntityId[]> => ({
  topic: [], context: [], problem: [], option: [], proposal: [],
  decision: [], action: [], deferred: [], question: [], unresolved: [],
});

export function createCanonicalState(): CanonicalMeetingState {
  return { entries: [], byUtteranceId: {}, byKind: EMPTY_BY_KIND(), revision: 0, policyVersion: PROMOTION_POLICY_VERSION };
}

function reindex(entries: CanonicalEntry[]): Pick<CanonicalMeetingState, "byUtteranceId" | "byKind"> {
  const byUtteranceId: Record<string, EntityId[]> = {};
  const byKind = EMPTY_BY_KIND();
  for (const entry of entries) {
    byKind[entry.kind].push(entry.id);
    for (const utteranceId of entry.evidence.utteranceIds) {
      byUtteranceId[utteranceId] = [...(byUtteranceId[utteranceId] ?? []), entry.id];
    }
  }
  return { byUtteranceId, byKind };
}

export function entriesOfKind(state: CanonicalMeetingState, kind: CanonicalKind): CanonicalEntry[] {
  const ids = new Set(state.byKind[kind]);
  return state.entries.filter((entry) => ids.has(entry.id));
}

export function reduceCanonical(state: CanonicalMeetingState, event: SemanticEvent): ReduceResult {
  switch (event.kind) {
    case "units_asserted": {
      // Re-asserting the same utterance replaces only its own entries, so
      // applying an event twice is idempotent rather than double-counting.
      const affectedIds = new Set(state.byUtteranceId[event.utterance.id] ?? []);
      const kept = state.entries.filter((entry) => !affectedIds.has(entry.id));
      const previousRevision = new Map(
        state.entries.filter((entry) => affectedIds.has(entry.id)).map((entry) => [entry.id, entry.entityRevision]),
      );

      const produced: CanonicalEntry[] = [];
      for (const assertion of event.assertions) {
        const text = sliceUnitText(event.utterance, assertion.unit);
        const candidate: PromotionCandidate = {
          unit: assertion.unit,
          text,
          utteranceId: event.utterance.id,
          assertionId: assertion.id,
        };
        const outcome = promoteUnit(candidate);
        const id = `${assertion.unit.id}:${outcome.kind}`;
        produced.push({
          id,
          kind: outcome.kind,
          label: text,
          basis: outcome.basis,
          evidence: { utteranceIds: [event.utterance.id], assertionIds: [assertion.id] },
          promotedBy: { policyVersion: state.policyVersion },
          owner: outcome.owner,
          deadline: outcome.deadline,
          entityRevision: (previousRevision.get(id) ?? 0) + 1,
        });
      }

      const entries = [...kept, ...produced];
      return {
        state: { ...state, entries, ...reindex(entries), revision: state.revision + 1 },
        changedEntityIds: produced.map((entry) => entry.id),
      };
    }

    case "relations_asserted": {
      // Relations do not create canonical entries on their own; they are held as
      // assertions and consumed by projections. Recorded as a revision bump so a
      // late refinement can tell that state moved.
      return { state: { ...state, revision: state.revision + 1 }, changedEntityIds: [] };
    }

    case "human_confirmation": {
      const entries = state.entries.map((entry) =>
        entry.id === event.entityId
          ? { ...entry, basis: "human_confirmed" as const, entityRevision: entry.entityRevision + 1 }
          : entry,
      );
      const changed = state.entries.some((entry) => entry.id === event.entityId) ? [event.entityId] : [];
      return { state: { ...state, entries, ...reindex(entries), revision: state.revision + 1 }, changedEntityIds: changed };
    }

    case "human_rejection": {
      const entries = state.entries.filter((entry) => entry.id !== event.entityId);
      const changed = entries.length === state.entries.length ? [] : [event.entityId];
      return { state: { ...state, entries, ...reindex(entries), revision: state.revision + 1 }, changedEntityIds: changed };
    }

    case "human_correction": {
      // The correction itself lives in the event log; canonical state changes
      // only once the corrected axes are re-asserted. Bumping the revision marks
      // the affected entries as moved so a refinement based on the old reading
      // is discarded (ADR 0023 §8).
      const affected = new Set(state.byUtteranceId[event.correction.target.utteranceId] ?? []);
      const entries = state.entries.map((entry) =>
        affected.has(entry.id) ? { ...entry, entityRevision: entry.entityRevision + 1 } : entry,
      );
      return { state: { ...state, entries, ...reindex(entries), revision: state.revision + 1 }, changedEntityIds: [...affected] };
    }
  }
}
