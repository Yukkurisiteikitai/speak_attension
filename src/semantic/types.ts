// Semantic Core type contract (ADR 0022 §3-§6, ADR 0023 §5-§8).
//
// Four layers, where an upper layer never rewrites a lower one:
//   1. RawUtterance / MeetingEvent  -- the only primary source, append-only
//   2. SemanticUnit                 -- 0..N per utterance, referenced by span
//   3. SemanticAssertion / RelationAssertion -- machine output is a claim, not a fact
//   4. CanonicalMeetingState        -- only what the single promotion policy admits
//
// Nothing here executes. The axes are deliberately independent: a value on one
// axis must never imply a value on another (see ADR 0022 §3 and invariant I11).

// ---------------------------------------------------------------------------
// Layer 1: raw utterance event log
// ---------------------------------------------------------------------------

export type UtteranceId = string;
export type SemanticUnitId = string;
export type AssertionId = string;
export type EntityId = string;

// Manual, replay, Web Speech and any future STT all normalize into the same
// utterance (ADR 0022 §2). A new provider adds a member here, nothing else.
export type InputProviderKind = "manual" | "replay" | "web_speech" | "external_stt";

export type RawUtterance = {
  id: UtteranceId;
  // Monotonic within a meeting. Ordering never relies on createdAt, which can
  // repeat when several utterances land in the same millisecond.
  seq: number;
  // Verbatim. Normalized forms are derived, never stored back over this.
  text: string;
  createdAt: number;
  // null when unknown. Never inferred from the text (ADR 0021 §5).
  speaker: string | null;
  provider: InputProviderKind;
  audio?: { startMs?: number; endMs?: number; confidence?: number };
};

export type MeetingEvent =
  | { kind: "utterance_added"; at: number; utterance: RawUtterance }
  | { kind: "human_correction"; at: number; correction: HumanCorrection }
  | { kind: "human_confirmation"; at: number; target: AssertionId; by: "facilitator" }
  | { kind: "human_rejection"; at: number; target: AssertionId; by: "facilitator" };

// ---------------------------------------------------------------------------
// Layer 2: semantic units and the six orthogonal axes
// ---------------------------------------------------------------------------

// What layer of the conversation the unit is about. Meeting management wins
// over a named artifact: "今日はスライド構成を決めます" is agenda-setting
// (meeting_process), not a statement about the slides.
export type Scope = "meeting_process" | "subject_matter" | "artifact_content" | "unknown";

export type SemanticRole =
  | "topic" | "agenda_item" | "context" | "problem" | "reason" | "evidence"
  | "option" | "proposal" | "decision" | "action" | "question"
  | "acknowledgement" | "other";

export type DiscourseAct =
  | "topic_start" | "enumerate" | "report" | "ask" | "suggest" | "advocate"
  | "oppose" | "decide" | "commit" | "defer" | "acknowledge" | "other";

export type Commitment =
  | "none" | "mentioned" | "considered" | "proposed"
  | "accepted" | "decided" | "committed" | "deferred" | "rejected";

// How grounded the reading is. "explicit" requires a marker in the span --
// content words alone are at most "inferred" (ADR 0022 §3).
export type EpistemicStatus = "explicit" | "inferred" | "ambiguous";

// Who made the claim. The realtime parser only ever produces "rule";
// "model" is reserved for the async refinement path (ADR 0023 §2).
export type AssertionProvenance = "rule" | "model" | "human";

export type SemanticAxes = {
  scope: Scope;
  role: SemanticRole;
  act: DiscourseAct;
  commitment: Commitment;
  epistemic: EpistemicStatus;
  provenance: AssertionProvenance;
};

// Character offsets into RawUtterance.text. Half-open: [start, end).
export type Span = { start: number; end: number };

export type SemanticUnit = {
  id: SemanticUnitId;
  utteranceId: UtteranceId;
  // The unit does not copy the text. Use sliceUnitText() to derive it, so the
  // raw utterance stays the only place the wording lives.
  span: Span;
  axes: SemanticAxes;
};

// ---------------------------------------------------------------------------
// Layer 3: assertions
// ---------------------------------------------------------------------------

export type EngineStamp = { engine: string; version: string };

// One claim about one unit. Several may coexist for the same unit (rule vs.
// model vs. human); resolution picks a winner per axis without deleting the
// losers, and `supersedes` keeps the history.
export type SemanticAssertion = {
  id: AssertionId;
  unit: SemanticUnit;
  confidence: number;
  producedBy: EngineStamp;
  createdAt: number;
  supersedes: AssertionId[];
};

export type RelationKind =
  | "supports" | "motivates" | "answers" | "decided_from"
  | "opposes" | "refines"
  // A first-class value: "we could not resolve this" is not the same as
  // "there is no relation" (ADR 0022 §4).
  | "unresolved";

// How the relation was arrived at. "proximity" is the old heuristic, kept but
// demoted: it can never be more than inferred (invariant I12).
export type RelationBasis = "explicit_marker" | "proximity" | "named_reference" | "human";

export type RelationAssertion = {
  id: AssertionId;
  from: SemanticUnitId;
  to: SemanticUnitId;
  relation: RelationKind;
  basis: RelationBasis;
  epistemic: EpistemicStatus;
  provenance: AssertionProvenance;
  confidence: number;
  producedBy: EngineStamp;
};

// ---------------------------------------------------------------------------
// Layer 3.5: human corrections
// ---------------------------------------------------------------------------

// A partial override. Axes left out stay machine-inferred, so correcting the
// role does not silently reset the commitment. Re-analysis replaces machine
// assertions and keeps these (ADR 0022 §5).
export type HumanCorrection = {
  id: string;
  at: number;
  target: { utteranceId: UtteranceId; unitId?: SemanticUnitId };
  axes: Partial<SemanticAxes>;
  // Fixing the segmentation itself, which one-label-per-utterance made
  // impossible to express.
  resegment?: Array<{ span: Span; axes: Partial<SemanticAxes> }>;
  note: string | null;
};

// ---------------------------------------------------------------------------
// Layer 4: canonical meeting state
// ---------------------------------------------------------------------------

// Why an entry is in canonical state. Carried in the type so a projection
// cannot render a rule's guess and a person's confirmation identically
// (ADR 0018, ADR 0023 §6).
export type PromotionBasis = "provisional" | "rule_explicit" | "human_confirmed";

export type CanonicalKind =
  | "topic" | "context" | "problem" | "option" | "proposal"
  | "decision" | "action" | "deferred" | "question" | "unresolved";

export type CanonicalEntry = {
  id: EntityId;
  kind: CanonicalKind;
  // Display text, derived from the unit's span at promotion time.
  label: string;
  basis: PromotionBasis;
  evidence: { utteranceIds: UtteranceId[]; assertionIds: AssertionId[] };
  promotedBy: { policyVersion: string };
  // Only meaningful for kind === "action".
  owner?: string | null;
  deadline?: string | null;
  // Bumped whenever this entry changes, so a late refinement can detect that
  // what it read has moved on (ADR 0023 §8).
  entityRevision: number;
};

export type CanonicalMeetingState = {
  entries: CanonicalEntry[];
  // Indexes so promotion re-evaluates only affected entries instead of
  // rebuilding (ADR 0023 §5).
  byUtteranceId: Record<UtteranceId, EntityId[]>;
  byKind: Record<CanonicalKind, EntityId[]>;
  revision: number;
  policyVersion: string;
};

// ---------------------------------------------------------------------------
// Events the canonical reducer consumes
// ---------------------------------------------------------------------------

export type SemanticEvent =
  | { kind: "units_asserted"; at: number; utterance: RawUtterance; assertions: SemanticAssertion[] }
  | { kind: "relations_asserted"; at: number; relations: RelationAssertion[] }
  | { kind: "human_correction"; at: number; correction: HumanCorrection }
  | { kind: "human_confirmation"; at: number; entityId: EntityId }
  | { kind: "human_rejection"; at: number; entityId: EntityId };

export type ReduceResult = {
  state: CanonicalMeetingState;
  // Which entries changed, so a projection can update selectively.
  changedEntityIds: EntityId[];
};

// ---------------------------------------------------------------------------
// Refinement path (types only in Phase 1 -- ADR 0023 §3, §8)
// ---------------------------------------------------------------------------

export type RefinementJob = {
  id: string;
  basedOnRevision: number;
  readEntities: Array<{ entityId: EntityId; entityRevision: number }>;
};

// Derives a unit's text without storing a second copy of the wording.
export function sliceUnitText(utterance: RawUtterance, unit: SemanticUnit): string {
  return utterance.text.slice(unit.span.start, unit.span.end);
}
