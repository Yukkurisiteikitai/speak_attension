import { describeEntry, reviewPolicy, REVIEW_POLICY_VERSION } from "./reviewPolicy";
import { canonicalUnitId } from "./canonicalReducer";
import type { MeetingItem, ItemReviewEvent } from "./meetingItem";
import type { MeetingEventLog } from "./rawUtterance";
import type { CanonicalMeetingState } from "./types";

export type MinutesHistoryEntry = ItemReviewEvent & { at: number };
export type MeetingMinutes = {
  items: MeetingItem[];
  pending: MeetingItem[];
  held: MeetingItem[];
  recorded: MeetingItem[];
  history: MinutesHistoryEntry[];
};

const lifecycle = new Set(["ItemWithdrawn", "ItemSuperseded"]);

export function isInactive(item: MeetingItem): boolean {
  return ["withdrawn", "superseded", "rejected"].includes(item.semanticState);
}

export function projectMeetingMinutes(meetingId: string, canonical: CanonicalMeetingState, log: MeetingEventLog): MeetingMinutes {
  const archivedPolicyVersion = log.policyVersion ?? REVIEW_POLICY_VERSION;
  const seen = new Set<string>();
  const history = log.events.flatMap((event) => {
    if (event.kind !== "item_review" || seen.has(event.event.id)) return [];
    seen.add(event.event.id);
    return [{ ...event.event, at: event.at }];
  });
  const latest = new Map<string, MinutesHistoryEntry>();
  const latestReview = new Map<string, MinutesHistoryEntry>();
  for (const event of history) {
    latest.set(event.after.id, event);
    if (!lifecycle.has(event.action)) latestReview.set(event.after.id, event);
  }

  const items = canonical.entries.flatMap((entry): MeetingItem[] => {
    const description = describeEntry(entry);
    if (!description) return [];
    const id = canonicalUnitId(entry);
    const policy = reviewPolicy(entry, description);
    const candidateReview = latestReview.get(id);
    let draft: MeetingItem = {
      ...description, ...policy, id, meetingId, policyVersion: REVIEW_POLICY_VERSION,
      evidenceRefs: [entry.source.evidence, ...(entry.supportingEvidence ?? [])],
      revision: entry.entityRevision + (latest.get(id)?.revision ?? 0),
      relatedIds: [...new Set((entry.related ?? []).map((relation) => relation.from === id ? relation.to : relation.from))],
      reviewState: "pending",
    };
    const reviewMatchesCanonical = candidateReview && candidateReview.after.semanticState === draft.semanticState &&
      candidateReview.after.kind === draft.kind && candidateReview.after.title === draft.title &&
      JSON.stringify(candidateReview.after.fields) === JSON.stringify(draft.fields);
    const review = reviewMatchesCanonical ? candidateReview : undefined;
    if (isInactive(draft) || review?.action === "ItemDismissed") draft.reviewState = "dismissed";
    else if (review?.action === "ItemHeld") draft.reviewState = "held";
    else if (review) {
      // The archive is the source of review history, but policy-derived fields
      // always come from the current projection. In particular, an automatic
      // record made under an older policy must be reviewed again when the
      // current policy no longer permits it.
      const policyChanged = archivedPolicyVersion !== draft.policyVersion || review.after.policyVersion !== draft.policyVersion;
      if (review.action === "ItemAutoRecorded" && policyChanged && !draft.canAutoRecord) {
        draft.reviewState = "pending";
      } else {
        draft.reviewState = review.after.reviewState;
      }
    }
    return [draft];
  }).sort((a, b) => a.evidenceRefs[0].timestamp - b.evidenceRefs[0].timestamp ||
    a.evidenceRefs[0].startOffset - b.evidenceRefs[0].startOffset);

  return {
    items, history,
    pending: items.filter((item) => item.reviewState === "pending"),
    held: items.filter((item) => item.reviewState === "held"),
    recorded: items.filter((item) => item.reviewState === "auto_recorded" || item.reviewState === "human_verified"),
  };
}
