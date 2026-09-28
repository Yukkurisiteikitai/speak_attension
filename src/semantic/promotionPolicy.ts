// The ONLY place that admits a semantic unit into canonical meeting state
// (ADR 0022 §6, ADR 0023 §6).
//
// Nothing else may construct a CanonicalEntry. The defect this replaces is that
// meetingDecisionGraph.ts wrote `state: "decided"` at node-construction time, so
// there was no single place to put a gate -- which is how a morning-greeting and
// an explicit 「まだ検討中です」 both became confirmed decisions.
//
// This module deliberately imports nothing from decisionSupport.ts: a system
// suggestion is not a decision (invariant I7), and the absence of that import is
// asserted in the tests.

import type {
  AssertionId, CanonicalKind, PromotionBasis, RelationAssertion, SemanticUnit, UtteranceId,
} from "./types";
import { extractActionDetails } from "./parseAxes";

export const PROMOTION_POLICY_VERSION = "1.0.0";

export type PromotionCandidate = {
  unit: SemanticUnit;
  // Derived from the unit's span by the caller, so this module never re-reads
  // the raw utterance.
  text: string;
  utteranceId: UtteranceId;
  assertionId: AssertionId;
  // True only when a person explicitly confirmed this reading.
  humanConfirmed?: boolean;
};

export type PromotionOutcome = {
  kind: CanonicalKind;
  basis: PromotionBasis;
  owner: string | null;
  deadline: string | null;
  // Which gate admitted it, for explaining a promotion in the UI and in tests.
  reason: string;
};

const WEAK_COMMITMENTS = new Set(["none", "mentioned", "considered", "proposed"]);

function basisFor(candidate: PromotionCandidate): PromotionBasis {
  if (candidate.humanConfirmed) return "human_confirmed";
  // I6: a reading that is not explicitly marked is never presented as a
  // confirmed fact, only as provisional.
  return candidate.unit.axes.epistemic === "explicit" ? "rule_explicit" : "provisional";
}

const unresolved = (reason: string): PromotionOutcome =>
  ({ kind: "unresolved", basis: "provisional", owner: null, deadline: null, reason });

// Exactly one outcome per unit. Returning a single kind is what makes the
// double-promotion in the legacy graph (the same utterance counted as both a
// decision and an action) structurally impossible (I13).
export function promoteUnit(candidate: PromotionCandidate): PromotionOutcome {
  const { scope, role, act, commitment, epistemic } = candidate.unit.axes;
  const basis = basisFor(candidate);
  const isMeetingProcess = scope === "meeting_process";

  // I8: an ambiguous reading goes no further than unresolved.
  if (epistemic === "ambiguous") return unresolved("epistemic=ambiguous");

  // I9: a deferred idea is parked, never decided or actioned.
  if (commitment === "deferred") {
    return { kind: "deferred", basis, owner: null, deadline: null, reason: "commitment=deferred" };
  }

  if (commitment === "rejected") return unresolved("commitment=rejected");

  // --- decision gate (ADR 0022 §6) ---
  // I2 via commitment, I4 via scope, I5/I10 via act, I11 because role is not
  // consulted at all here, I6 via basis.
  const decisionGate =
    act === "decide" &&
    commitment === "decided" &&
    !isMeetingProcess &&
    epistemic === "explicit" &&
    basis !== "provisional";
  if (decisionGate) {
    return { kind: "decision", basis, owner: null, deadline: null, reason: "explicit decision marker" };
  }

  // --- action gate ---
  // I3: a proposal is not an action, however it is phrased.
  const details = extractActionDetails(candidate.text);
  const actionGate =
    act === "commit" &&
    commitment === "committed" &&
    role !== "proposal" &&
    !isMeetingProcess &&
    epistemic === "explicit" &&
    basis !== "provisional" &&
    // An execution verb with no owner and no deadline is under-specified; the
    // weaker reading is safer than a confirmed action nobody owns.
    (details.owner !== null || details.deadline !== null);
  if (actionGate) {
    return { kind: "action", basis, owner: details.owner, deadline: details.deadline, reason: "grounded execution commitment" };
  }

  // Anything that reached here is not a decision or an action. The remaining
  // kinds are all non-committal, so a weaker basis is acceptable.

  // I1: enumerating options is not proposing one. Checked before the proposal
  // gate so an option can never fall through into proposals.
  if (role === "option") {
    return { kind: "option", basis, owner: null, deadline: null, reason: "option reading" };
  }
  if (role === "proposal" && commitment === "proposed") {
    return { kind: "proposal", basis, owner: null, deadline: null, reason: "proposal reading" };
  }
  if (role === "question") {
    return { kind: "question", basis, owner: null, deadline: null, reason: "question reading" };
  }
  if (act === "topic_start" || role === "topic") {
    return { kind: "topic", basis, owner: null, deadline: null, reason: "topic start" };
  }
  if (role === "problem") {
    return { kind: "problem", basis, owner: null, deadline: null, reason: "problem reading" };
  }
  if (role === "context") {
    return { kind: "context", basis, owner: null, deadline: null, reason: "context reading" };
  }

  // I14: nothing is discarded. An unclassified unit stays visible as unresolved
  // rather than disappearing, so a missed decision is still on screen.
  return unresolved(`no gate matched (role=${role}, act=${act}, commitment=${commitment})`);
}

// I12: a relation inferred from mere adjacency can never be presented as
// confirmed, no matter how confident the extractor was.
export function promoteRelationBasis(relation: Pick<RelationAssertion, "basis" | "epistemic">): PromotionBasis {
  if (relation.basis === "human") return "human_confirmed";
  if (relation.basis === "proximity") return "provisional";
  return relation.epistemic === "explicit" ? "rule_explicit" : "provisional";
}

// Kinds that assert something was settled. Used by the reducer and by tests
// that must not let a weak basis reach them.
export const CONFIRMED_KINDS: ReadonlySet<CanonicalKind> = new Set<CanonicalKind>(["decision", "action"]);

export function isWeakCommitment(commitment: string): boolean {
  return WEAK_COMMITMENTS.has(commitment);
}
