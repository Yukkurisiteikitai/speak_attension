import type {
  CanonicalEntry, CanonicalKind, CanonicalMeetingState, EntityId, HumanCorrection,
  ReduceResult, RelationAssertion, SemanticEvent,
} from "./types";
import { promoteUnit, PROMOTION_POLICY_VERSION } from "./promotionPolicy";
import { sliceUnitText } from "./types";
import { resolveUnit } from "./resolveUnit";

const EMPTY_BY_KIND = (): Record<CanonicalKind, EntityId[]> => ({
  topic: [], context: [], problem: [], option: [], proposal: [],
  decision: [], action: [], deferred: [], question: [], unresolved: [],
});

export function createCanonicalState(): CanonicalMeetingState {
  return {
    entries: [], corrections: [], relations: [], byUtteranceId: {}, byKind: EMPTY_BY_KIND(),
    revision: 0, policyVersion: PROMOTION_POLICY_VERSION,
  };
}

function reindex(entries: CanonicalEntry[]): Pick<CanonicalMeetingState, "byUtteranceId" | "byKind"> {
  const byUtteranceId: Record<string, EntityId[]> = Object.create(null);
  const byKind = EMPTY_BY_KIND();
  for (const entry of entries) {
    if (!entry.disposition) byKind[entry.kind].push(entry.id);
    const utteranceId = entry.source.evidence.utteranceId;
    (byUtteranceId[utteranceId] ??= []).push(entry.id);
  }
  return { byUtteranceId, byKind };
}

export function entriesOfKind(state: CanonicalMeetingState, kind: CanonicalKind): CanonicalEntry[] {
  const ids = new Set(state.byKind[kind]);
  return state.entries.filter((entry) => ids.has(entry.id));
}

export function canonicalUnitId(entry: CanonicalEntry): string {
  return entry.source.assertion.unit.id;
}

function deriveEntry(
  source: CanonicalEntry["source"], corrections: HumanCorrection[],
  entityRevision: number, policyVersion: string,
): CanonicalEntry {
  const { assertion, evidence } = source;
  const resolved = resolveUnit(assertion.unit.id, [assertion], corrections)!;
  const applicable = corrections.filter(({ target }) =>
    target.utteranceId === evidence.utteranceId && (!target.unitId || target.unitId === assertion.unit.id));
  const latestItem = applicable.filter((event) => event.item).at(-1);
  const axes = resolved.axes;
  let correction = latestItem?.item;
  const laterRole = latestItem && applicable.slice(applicable.indexOf(latestItem) + 1).some((event) => event.axes.role !== undefined);
  if (correction && laterRole) {
    const kind = axes.role === "option" ? "proposal" : axes.role === "problem" || axes.role === "question" ? "issue"
      : axes.role === "decision" && correction.kind === "schedule" ? "schedule"
      : ["decision", "action", "proposal"].includes(axes.role) ? axes.role as "decision" | "action" | "proposal" : null;
    correction = kind ? { ...correction, kind,
      semanticState: kind !== correction.kind ? "candidate" : correction.semanticState } : undefined;
  }
  const outcome = promoteUnit({
    unit: { ...assertion.unit, axes }, text: correction?.fields.content || evidence.text,
    utteranceId: evidence.utteranceId, assertionId: assertion.id, correction,
    roleCorrected: resolved.humanOverriddenAxes.includes("role"),
  });
  return {
    id: assertion.unit.id + ":" + outcome.kind, kind: outcome.kind, source, axes, correction,
    humanRevised: applicable.length > 0,
    label: correction?.title ?? evidence.text,
    basis: outcome.basis, rationale: outcome.reason, owner: outcome.owner, deadline: outcome.deadline,
    entityRevision, promotedBy: { policyVersion },
    evidence: { utteranceIds: [evidence.utteranceId], assertionIds: [assertion.id] },
  };
}

function applyRelations(entries: CanonicalEntry[], relations: RelationAssertion[]): CanonicalEntry[] {
  const byUnit = new Map(entries.map((entry) => [canonicalUnitId(entry), entry]));
  const incoming = new Map<string, RelationAssertion[]>();
  const outgoing = new Map<string, RelationAssertion[]>();
  for (const relation of relations) {
    if (!byUnit.has(relation.from) || !byUnit.has(relation.to)) continue;
    const target = incoming.get(relation.to) ?? [];
    const source = outgoing.get(relation.from) ?? [];
    target.push(relation);
    source.push(relation);
    incoming.set(relation.to, target);
    outgoing.set(relation.from, source);
  }
  const dispositions = new Map<string, CanonicalEntry["disposition"]>();
  for (const [id, links] of incoming) {
    const effective = links.filter((link) => !byUnit.get(link.from)?.humanRevised);
    if (effective.some((link) => link.relation === "withdraws")) {
      dispositions.set(id, "withdrawn");
    } else if (effective.some((link) => link.relation === "supersedes")) {
      dispositions.set(id, "superseded");
    }
  }
  return entries.map((entry) => {
    const id = canonicalUnitId(entry);
    const related = [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])];
    const links = incoming.get(id) ?? [];
    const disposition = dispositions.get(id) ??
      (entry.correction?.semanticState === "withdrawn" || entry.correction?.semanticState === "superseded"
        ? entry.correction.semanticState : undefined);
    const blocked = links.some((link) => !byUnit.get(link.from)?.humanRevised && !dispositions.has(link.from) &&
      (link.relation === "opposes" || (link.relation === "conditions" && !entry.correction))) ||
      (outgoing.get(id) ?? []).some((link) => {
        const other = byUnit.get(link.to)!;
        return link.relation === "refines" && (dispositions.has(link.to) ||
          other.disposition || (other.humanRevised && !["decision", "action"].includes(other.kind)));
      });
    const supportingEvidence = [...new Set(links
      .filter((link) => !byUnit.get(link.from)?.humanRevised && (!dispositions.has(link.from) || link.relation === "withdraws"))
      .map((link) => byUnit.get(link.from)!.source.evidence))];

    if (entry.disposition === disposition && Boolean(entry.blocked) === blocked &&
        JSON.stringify(entry.related ?? []) === JSON.stringify(related) &&
        JSON.stringify(entry.supportingEvidence ?? []) === JSON.stringify(supportingEvidence)) return entry;
    return { ...entry, related, disposition, blocked, supportingEvidence, entityRevision: entry.entityRevision + 1 };
  });
}

export function reduceCanonical(state: CanonicalMeetingState, event: SemanticEvent): ReduceResult {
  let entries = state.entries;
  let { relations, corrections } = state;
  switch (event.kind) {
    case "units_asserted": {
      const affected = new Set(state.byUtteranceId[event.utterance.id] ?? []);
      const previous = new Map(entries.filter((entry) => affected.has(entry.id)).map((entry) => [canonicalUnitId(entry), entry]));
      const produced = new Map<string, CanonicalEntry>();
      for (const assertion of event.assertions) {
        const { utterance } = event;
        const evidence = {
          utteranceId: utterance.id, speakerId: utterance.speaker, timestamp: utterance.createdAt,
          elapsedMs: utterance.audio?.startMs,
          startOffset: assertion.unit.span.start, endOffset: assertion.unit.span.end,
          text: sliceUnitText(utterance, assertion.unit),
        };
        const prior = previous.get(assertion.unit.id);
        const unchanged = prior && JSON.stringify(prior.source.assertion) === JSON.stringify(assertion) &&
          JSON.stringify(prior.source.evidence) === JSON.stringify(evidence);
        produced.set(assertion.unit.id, unchanged ? prior : deriveEntry(
          { assertion, evidence }, corrections, (prior?.entityRevision ?? 0) + 1, state.policyVersion,
        ));
      }
      if (produced.size === previous.size && [...produced].every(([id, entry]) => previous.get(id) === entry)) {
        return { state, changedEntityIds: [] };
      }
      entries = [...entries.filter((entry) => !affected.has(entry.id)), ...produced.values()];
      break;
    }
    case "relations_asserted": {
      const merged = new Map(relations.map((relation) => [relation.id, relation]));
      for (const relation of event.relations) if (!merged.has(relation.id)) merged.set(relation.id, relation);
      if (merged.size === relations.length) return { state, changedEntityIds: [] };
      relations = [...merged.values()];
      break;
    }
    case "human_correction": {
      const { correction } = event;
      if (corrections.some((prior) => prior.id === correction.id)) return { state, changedEntityIds: [] };
      corrections = [...corrections, correction];
      entries = entries.map((entry) =>
        entry.source.evidence.utteranceId === correction.target.utteranceId &&
        (!correction.target.unitId || correction.target.unitId === canonicalUnitId(entry))
          ? deriveEntry(entry.source, corrections, entry.entityRevision + 1, state.policyVersion)
          : entry);
      break;
    }
    case "human_confirmation":
      entries = entries.map((entry) => entry.id === event.entityId
        ? { ...entry, basis: "human_confirmed", entityRevision: entry.entityRevision + 1 } : entry);
      break;
    case "human_rejection":
      entries = entries.filter((entry) => entry.id !== event.entityId);
      break;
  }

  if (relations.length || corrections.length) entries = applyRelations(entries, relations);
  const retained = new Set(entries);
  const previous = new Set(state.entries);
  const changedEntityIds = [...new Set([
    ...state.entries.filter((entry) => !retained.has(entry)).map((entry) => entry.id),
    ...entries.filter((entry) => !previous.has(entry)).map((entry) => entry.id),
  ])];
  return {
    state: { ...state, entries, corrections, relations, ...reindex(entries), revision: state.revision + 1 },
    changedEntityIds,
  };
}
