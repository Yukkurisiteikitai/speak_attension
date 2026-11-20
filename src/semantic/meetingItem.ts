export type MeetingItemKind = "decision" | "action" | "schedule" | "proposal" | "issue";
export type SemanticState = "candidate" | "agreed" | "deferred" | "rejected" | "withdrawn" | "superseded";
export type ReviewState = "pending" | "auto_recorded" | "human_verified" | "held" | "dismissed";
export type RiskLevel = "low" | "medium" | "high";

export type EvidenceRef = {
  utteranceId: string;
  speakerId: string | null;
  timestamp: number;
  elapsedMs?: number;
  startOffset: number;
  endOffset: number;
  text: string;
};

export type ItemFields = {
  owner: string;
  deadline: string;
  target: string;
  condition: string;
  content: string;
};

export type ItemCorrection = {
  title: string;
  kind: MeetingItemKind;
  semanticState: SemanticState;
  fields: ItemFields;
};

export type MeetingItem = ItemCorrection & {
  id: string;
  meetingId: string;
  evidenceRefs: EvidenceRef[];
  reviewState: ReviewState;
  riskLevel: RiskLevel;
  reviewReasons: string[];
  missing: string[];
  canVerify: boolean;
  canAutoRecord: boolean;
  relatedIds: string[];
  revision: number;
  policyVersion: string;
};

export type ReviewAction =
  | { kind: "ItemHumanVerified" | "ItemHeld" | "ItemDismissed" | "ItemReviewReopened" | "ReviewActionReverted" }
  | { kind: "ItemCorrected"; correction: ItemCorrection; reason: string };

export type ReviewTarget = Pick<MeetingItem, "id" | "revision">;
export type ItemReviewEvent = {
  id: string;
  action: ReviewAction["kind"] | "ItemAutoRecorded" | "ItemWithdrawn" | "ItemSuperseded";
  actor: "facilitator" | "rule";
  canonicalRevision: number;
  revision: number;
  before: MeetingItem | null;
  after: MeetingItem;
  reason: string;
  reverts?: string;
};
