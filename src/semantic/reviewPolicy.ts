import { authorityMarker, conditionMarker, firstPerson, isScheduleMention, scheduleSubject, scheduleTime, uncertaintyMarker, withdrawalMarker } from "./commitmentMarkers";
import { extractActionDetails } from "./parseAxes";
import type { CanonicalEntry } from "./types";
import type { ItemCorrection, ItemFields, RiskLevel } from "./meetingItem";

export const REVIEW_POLICY_VERSION = "1.0.0";

export function describeEntry(entry: CanonicalEntry): ItemCorrection | null {
  const { text, speakerId } = entry.source.evidence;
  const schedule = isScheduleMention(text);
  if (["withdrawn", "superseded"].includes(entry.correction?.semanticState ?? "")) return entry.correction!;
  if (entry.correction) return { ...entry.correction, semanticState: entry.disposition ?? entry.correction.semanticState };
  if (entry.related?.some((link) => link.from === entry.source.assertion.unit.id &&
      (["withdraws", "confirms", "conditions"].includes(link.relation) ||
        (!schedule && !withdrawalMarker.test(text) && link.relation === "opposes")))) return null;

  const { role, commitment, scope } = entry.axes;
  if (scope === "meeting_process") return null;
  const action = entry.kind === "action" || role === "action";
  const decision = entry.kind === "decision" || role === "decision";
  const kind = schedule ? "schedule" : action ? "action" : decision ? "decision"
    : ["question", "problem"].includes(entry.kind) || withdrawalMarker.test(text) ? "issue"
    : ["proposal", "option", "deferred"].includes(entry.kind) || commitment === "considered" ||
      authorityMarker.test(text) || conditionMarker.test(text) || uncertaintyMarker.test(text) ? "proposal" : null;
  if (!kind) return null;

  const evidence = entry.supportingEvidence ?? [];
  const condition = [text, ...evidence.map((ref) => ref.text)].find((phrase) => conditionMarker.test(phrase)) ?? "";
  const actionDetails = action ? extractActionDetails(text) : null;
  const target = schedule ? scheduleSubject(text)
    : decision ? text.match(/^(.{2,40}?)(?:を採用|に決定|に決め)/)?.[1] : undefined;
  const fields: ItemFields = {
    owner: action ? (firstPerson.test(text) ? speakerId ?? "" : entry.owner ?? actionDetails?.owner ?? "") : "",
    deadline: schedule ? text.match(scheduleTime)?.[0] ?? "" : entry.deadline ?? actionDetails?.deadline ?? "",
    target: target ?? "",
    condition,
    content: entry.label,
  };
  const conflicted = entry.blocked;
  const semanticState = entry.disposition ?? (commitment === "rejected" ? "rejected"
    : entry.kind === "deferred" ? "deferred"
    : !conflicted && !condition && ["action", "decision"].includes(entry.kind) ? "agreed" : "candidate");
  return { kind, title: entry.label, semanticState, fields };
}

export function reviewPolicy(entry: CanonicalEntry, item: ItemCorrection) {
  const { evidence } = entry.source;
  const { fields, kind, semanticState } = item;
  const allText = [item.title, ...Object.values(fields), evidence.text, ...(entry.supportingEvidence ?? []).map((ref) => ref.text)].join("\n");
  const authority = authorityMarker.test(allText);
  const uncertainty = !entry.correction && uncertaintyMarker.test(evidence.text);
  const referenced = !entry.correction && /^(?:この案|その案|それ|これ|こちら|あれ)(?:で|に|を)/.test(evidence.text);
  const missing = [
    !fields.content && "記録内容",
    kind === "action" && !fields.owner && "担当者",
    ["action", "schedule"].includes(kind) && !fields.deadline && "期限・日時",
    kind === "schedule" && !fields.target && "日程の対象",
    (!evidence.text.trim() || evidence.endOffset <= evidence.startOffset) && "元発言",
  ].filter((value): value is string => typeof value === "string");
  const riskLevel: RiskLevel = authority ? "high" :
    fields.condition || uncertainty || referenced || entry.blocked || missing.length ? "medium" : "low";
  const settled = ["decision", "action", "schedule"].includes(kind) && semanticState === "agreed";
  const canVerify = Boolean(settled && !authority && !fields.condition && !uncertainty &&
    !referenced && !entry.blocked && missing.length === 0);

  const explicitAgreement = entry.related?.some((link) =>
    link.to === entry.source.assertion.unit.id && link.relation === "confirms") &&
    Boolean(entry.supportingEvidence?.length);
  const explicitDecision = fields.target && !/^(?:案|方針|方法|その方法|この方法)$/.test(fields.target) &&
    /(?:を採用します|に決定します|に決めます)[。！!\s]*$/.test(evidence.text);
  const selfCommitment = Boolean(evidence.speakerId && firstPerson.test(evidence.text) &&
    /(?:作成|対応|確認|実施|提出|修正|準備)(?:します)[。！!\s]*$/.test(evidence.text));
  const canAutoRecord = Boolean(canVerify && !entry.humanRevised && riskLevel === "low" &&
    entry.basis === "rule_explicit" && (kind === "schedule" ? explicitAgreement
      : kind === "action" ? selfCommitment : explicitDecision));

  const reviewReasons = [
    authority && "承認権限の確認が必要",
    fields.condition && "条件が未解決",
    uncertainty && "推測や仮の表現を含む",
    referenced && "対象を発言だけでは特定できない",
    entry.blocked && "関連発言に条件・異議・撤回・訂正がある",
    withdrawalMarker.test(evidence.text) && !entry.correction && "撤回対象を特定できない",
    !settled && "決定や引き受けを確認できない",
    missing.length > 0 && `未確定の情報：${missing.join("、")}`,
    entry.correction && "操作担当者が内容を訂正",
    canAutoRecord && (kind === "schedule" ? "別の話者が日時に明示的に合意"
      : kind === "action" ? "担当者本人が期限付きで引き受けた" : "対象を明示して選択を確定"),
    canVerify && !canAutoRecord && "記録内容を確認できるが自動記録の条件を満たさない",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return { riskLevel, missing, reviewReasons, canVerify, canAutoRecord };
}
