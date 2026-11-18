import { canonicalUnitId, reduceCanonical } from "./canonicalReducer";
import { isInactive, projectMeetingMinutes } from "./meetingMinutesProjection";
import { appendEvent, type MeetingEventLog } from "./rawUtterance";
import type { CanonicalMeetingState, HumanCorrection, SemanticAxes } from "./types";
import type { ItemCorrection, ItemReviewEvent, MeetingItem, ReviewAction, ReviewTarget } from "./meetingItem";

type ReviewInput = { canonical: CanonicalMeetingState; log: MeetingEventLog };
export type ReviewResult = { ok: true } | { ok: false; message: string };

export function canBulkVerify(item: MeetingItem): boolean {
  return item.riskLevel === "low" && item.reviewState === "pending" && item.canVerify;
}

function appendReviewEvent(
  state: ReviewInput, at: number, event: Omit<ItemReviewEvent, "id" | "revision" | "canonicalRevision">,
): ReviewInput {
  const previous = state.log.events.filter((entry) =>
    entry.kind === "item_review" && entry.event.after.id === event.after.id).length;
  const revision = previous + 1;
  const canonicalRevision = state.canonical.entries.find((entry) => canonicalUnitId(entry) === event.after.id)!.entityRevision;
  const after = { ...event.after, revision: canonicalRevision + revision };
  const review = { ...event, id: event.after.id + ":review:" + revision, revision, canonicalRevision, after };
  return { ...state, log: appendEvent(state.log, { kind: "item_review", at, event: review }) };
}

export function synchronizeReview(
  state: ReviewInput, before: ReviewInput, meetingId: string, at: number, ended: boolean,
): ReviewInput {
  if (state === before) return state;
  const previous = projectMeetingMinutes(meetingId, before.canonical, before.log);
  const current = projectMeetingMinutes(meetingId, state.canonical, state.log);
  const priorItems = new Map(previous.items.map((item) => [item.id, item]));
  const reviewed = new Set(current.history.map((event) => event.after.id));
  for (const item of current.items) {
    const prior = priorItems.get(item.id);
    if (item.semanticState !== prior?.semanticState && (item.semanticState === "withdrawn" || item.semanticState === "superseded")) {
      state = appendReviewEvent(state, at, {
        action: item.semanticState === "withdrawn" ? "ItemWithdrawn" : "ItemSuperseded",
        actor: "rule", before: prior ?? null, after: item, reason: "後続の発言を反映",
      });
    } else if (ended && item.canAutoRecord && item.reviewState === "pending" && !reviewed.has(item.id)) {
      state = appendReviewEvent(state, at, {
        action: "ItemAutoRecorded", actor: "rule", before: item,
        after: { ...item, reviewState: "auto_recorded" }, reason: item.reviewReasons.join("、"),
      });
    }
  }
  return state;
}

export function applyItemCorrection(state: ReviewInput, correction: HumanCorrection, meetingId?: string): ReviewInput {
  const { state: canonical } = reduceCanonical(state.canonical, { kind: "human_correction", at: correction.at, correction });
  if (canonical === state.canonical) return state;
  let result = { canonical, log: appendEvent(state.log, { kind: "human_correction", at: correction.at, correction }) };
  if (!meetingId) return result;
  const previous = new Map(projectMeetingMinutes(meetingId, state.canonical, state.log).items.map((item) => [item.id, item]));
  for (const item of projectMeetingMinutes(meetingId, canonical, result.log).items) {
    const before = previous.get(item.id);
    previous.delete(item.id);
    if (item.revision === before?.revision) continue;
    result = appendReviewEvent(result, correction.at, {
      action: "ItemCorrected", actor: "facilitator", before: before ?? null,
      after: { ...item, reviewState: isInactive(item) ? "dismissed" : "pending" },
      reason: correction.note ?? "タイムラインの分類を訂正",
    });
  }
  for (const before of previous.values()) {
    if (!canonical.entries.some((entry) => canonicalUnitId(entry) === before.id)) continue;
    result = appendReviewEvent(result, correction.at, {
      action: "ItemCorrected", actor: "facilitator", before,
      after: { ...before, semanticState: "rejected", reviewState: "dismissed" },
      reason: correction.note ?? "タイムラインの分類を訂正し、議事録の対象から除外",
    });
  }
  return result;
}

function correctedAxes(correction: ItemCorrection): Partial<SemanticAxes> {
  const role = correction.kind === "issue" ? "problem" : correction.kind === "schedule" ? "decision" : correction.kind;
  if (correction.semanticState === "agreed") {
    return { role, act: role === "action" ? "commit" : "decide",
      commitment: role === "action" ? "committed" : "decided", epistemic: "explicit" };
  }
  return {
    role, act: "suggest", epistemic: "explicit",
    commitment: correction.semanticState === "deferred" ? "deferred"
      : correction.semanticState === "rejected" ? "rejected"
      : correction.semanticState === "candidate" ? "proposed" : "none",
  };
}

export function applyReviewAction(
  initial: ReviewInput, meetingId: string, targets: ReviewTarget[], action: ReviewAction, at: number, bulk = false,
): ReviewResult & { state: ReviewInput } {
  const minutes = projectMeetingMinutes(meetingId, initial.canonical, initial.log);
  const byId = new Map(minutes.items.map((item) => [item.id, item]));
  const items = targets.map((target) => byId.get(target.id));
  const fail = (message: string) => ({ ok: false as const, state: initial, message });
  if (!items.length || new Set(targets.map((item) => item.id)).size !== targets.length ||
      items.some((item, index) => item?.revision !== targets[index].revision)) {
    return fail("項目が更新されました。対象を選び直してください。");
  }
  if (bulk ? action.kind !== "ItemHumanVerified" || items.some((item) => !canBulkVerify(item!)) : items.length !== 1) {
    return fail("一括確認できるのは、要確認の低リスク項目のみです。");
  }

  let state = initial;
  for (const item of items as MeetingItem[]) {
    let after = item;
    let reason: string;
    let reverts: string | undefined;
    const latest = minutes.history.filter((event) => event.after.id === item.id).at(-1);
    switch (action.kind) {
      case "ItemHumanVerified":
        if (!item.canVerify || !["pending", "held"].includes(item.reviewState)) return fail("確定の条件を満たしていません。");
        after = { ...item, reviewState: "human_verified" };
        reason = "議事録の内容を確認";
        break;
      case "ItemHeld":
        if (isInactive(item) || item.reviewState === "dismissed") return fail("この項目は保留できません。");
        after = { ...item, reviewState: "held" };
        reason = "操作担当者が保留";
        break;
      case "ItemDismissed":
        if (isInactive(item) || item.reviewState === "dismissed") return fail("この項目は除外できません。");
        after = { ...item, reviewState: "dismissed" };
        reason = "操作担当者が議事録から除外";
        break;
      case "ItemReviewReopened":
        if (isInactive(item) || item.reviewState === "pending") return fail("この項目は再審査に戻せません。");
        after = { ...item, reviewState: "pending" };
        reverts = latest?.id;
        reason = "再審査に戻した";
        break;
      case "ReviewActionReverted": {
        const entry = state.canonical.entries.find((candidate) => canonicalUnitId(candidate) === item.id);
        if (!latest?.before || latest.canonicalRevision !== entry?.entityRevision ||
            !["ItemHeld", "ItemDismissed", "ItemHumanVerified", "ItemReviewReopened"].includes(latest.action)) {
          return fail("取り消せる直前の確認操作がありません。");
        }
        after = { ...item, reviewState: latest.before.reviewState };
        reason = "直前の確認操作を取り消した";
        reverts = latest.id;
        break;
      }
      case "ItemCorrected": {
        if (!action.correction.title.trim() || !action.reason.trim()) return fail("項目タイトルと訂正理由を入力してください。");
        const correction = {
          title: action.correction.title.trim(),
          kind: action.correction.kind,
          semanticState: action.correction.semanticState,
          fields: {
            owner: action.correction.fields.owner.trim(), deadline: action.correction.fields.deadline.trim(),
            target: action.correction.fields.target.trim(), condition: action.correction.fields.condition.trim(),
            content: action.correction.fields.content.trim(),
          },
        };
        state = applyItemCorrection(state, {
          id: item.id + ":correction:" + item.revision, at, target: { unitId: item.id, utteranceId: item.evidenceRefs[0].utteranceId },
          axes: correctedAxes(correction), item: correction, note: action.reason.trim(),
        });
        after = projectMeetingMinutes(meetingId, state.canonical, state.log).items.find((candidate) => candidate.id === item.id)!;
        if (!isInactive(after)) after = { ...after, reviewState: "pending" };
        reason = action.reason.trim();
        break;
      }
    }
    state = appendReviewEvent(state, at, { action: action.kind, actor: "facilitator", before: item, after, reason, reverts });
  }
  return { ok: true, state };
}
