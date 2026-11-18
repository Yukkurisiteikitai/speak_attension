import { createCanonicalState, reduceCanonical } from "./canonicalReducer";
import { projectMeetingMinutes } from "./meetingMinutesProjection";
import { runFastPath, emptyFastPathContext, FAST_PATH_CONTEXT_WINDOW } from "./fastPath";
import { recentUtterances, type MeetingEventLog } from "./rawUtterance";

import type { TimedTranscriptSegment } from "../types/topic";
import type { CanonicalMeetingState, SemanticAssertion } from "./types";
import type { MeetingItem } from "./meetingItem";
import type { MeetingStateConsistency } from "./meetingStateConsistency";

export const MEETING_ARCHIVE_SCHEMA_VERSION = 1;

export type MeetingArchive = {
  schemaVersion: 1;
  id: string;
  metadata: { title: string; startedAt: number; endedAt: number };
  policyVersion: string;
  legacyGraph: import("../types/topic").MeetingGraph;
  legacyEvents: ArchivedLegacyEvent[];
  events: MeetingEventLog["events"];
  stateConsistency: MeetingStateConsistency;
};

export type ArchiveProjection = {
  assertions: SemanticAssertion[];
  canonical: CanonicalMeetingState;
  timelineItems: MeetingItem[];
};

export type ArchivedLegacyEvent = {
  id: string;
  text: string;
  createdAt: number;
  source: "manual" | "speech" | "replay";
  speaker: string | null;
};

export type ArchivedTranscript = {
  id: string;
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
};

export type ArchiveValidationResult =
  | { valid: true; archive: MeetingArchive }
  | { valid: false; reason: "invalid_json" | "unsupported_schema" | "invalid_data" | "corrupt_evidence" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidArchivedItem(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.fields)) return false;
  const fields = value.fields;
  return typeof value.id === "string" && typeof value.meetingId === "string" &&
    typeof value.title === "string" && ["decision", "action", "schedule", "proposal", "issue"].includes(value.kind as string) &&
    ["candidate", "agreed", "deferred", "rejected", "withdrawn", "superseded"].includes(value.semanticState as string) &&
    ["pending", "auto_recorded", "human_verified", "held", "dismissed"].includes(value.reviewState as string) &&
    ["low", "medium", "high"].includes(value.riskLevel as string) && Number.isInteger(value.revision) &&
    typeof value.policyVersion === "string" &&
    ["owner", "deadline", "target", "condition", "content"].every((key) => typeof fields[key] === "string") &&
    Array.isArray(value.evidenceRefs);
}

function hasValidReference(event: MeetingArchive["events"][number], utterances: Map<string, string>): boolean {
  if (event.kind === "human_correction") {
    const text = utterances.get(event.correction.target.utteranceId);
    if (text === undefined) return false;
    const spans = event.correction.resegment;
    return !spans || spans.every(({ span }) =>
      Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end <= text.length);
  }
  if (event.kind !== "item_review") return true;
  const refs = [...(event.event.before?.evidenceRefs ?? []), ...event.event.after.evidenceRefs];
  return refs.every((ref) => {
    const text = utterances.get(ref.utteranceId);
    return text !== undefined && Number.isInteger(ref.startOffset) && Number.isInteger(ref.endOffset) &&
      ref.startOffset >= 0 && ref.endOffset > ref.startOffset && ref.endOffset <= text.length &&
      text.slice(ref.startOffset, ref.endOffset) === ref.text;
  });
}

export function validateMeetingArchive(value: unknown): ArchiveValidationResult {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return { valid: false, reason: "invalid_json" }; }
  }
  if (!isRecord(parsed)) return { valid: false, reason: "invalid_data" };
  if (parsed.schemaVersion !== MEETING_ARCHIVE_SCHEMA_VERSION) return { valid: false, reason: "unsupported_schema" };
  if (typeof parsed.id !== "string" || !parsed.id || typeof parsed.policyVersion !== "string" ||
      !isRecord(parsed.metadata) || typeof parsed.metadata.title !== "string" || !isRecord(parsed.legacyGraph) ||
      parsed.legacyGraph.meetingId !== parsed.id || typeof parsed.legacyGraph.title !== "string" ||
      typeof parsed.legacyGraph.rootTopicId !== "string" || !Array.isArray(parsed.legacyGraph.nodes) ||
      parsed.legacyGraph.nodes.some((node) => !isRecord(node) || typeof node.id !== "string" || typeof node.title !== "string") ||
      !Array.isArray(parsed.legacyGraph.edges) || !Array.isArray(parsed.legacyGraph.gaps) ||
      !Array.isArray(parsed.legacyEvents) || parsed.legacyEvents.some((event) =>
        !isRecord(event) || typeof event.id !== "string" || typeof event.text !== "string" ||
        !Number.isFinite(event.createdAt) || !["manual", "speech", "replay"].includes(event.source as string) ||
        !(event.speaker === null || typeof event.speaker === "string")) ||
      !Number.isFinite(parsed.metadata.startedAt) || !Number.isFinite(parsed.metadata.endedAt) ||
      !Array.isArray(parsed.events) || (parsed.stateConsistency !== undefined &&
        (!isRecord(parsed.stateConsistency) || !Array.isArray(parsed.stateConsistency.canonicalOnlyDecisions) ||
          !Array.isArray(parsed.stateConsistency.dashboardOnlyDecisions) ||
          parsed.stateConsistency.canonicalOnlyDecisions.some((title) => typeof title !== "string") ||
          parsed.stateConsistency.dashboardOnlyDecisions.some((title) => typeof title !== "string")))) return { valid: false, reason: "invalid_data" };

  const events = parsed.events as MeetingArchive["events"];
  if (events.some((event) => !isRecord(event) || typeof event.kind !== "string" || !Number.isFinite(event.at))) {
    return { valid: false, reason: "invalid_data" };
  }
  const legacyIds = new Set<string>();
  for (const event of parsed.legacyEvents as ArchivedLegacyEvent[]) {
    if (legacyIds.has(event.id)) return { valid: false, reason: "invalid_data" };
    legacyIds.add(event.id);
  }
  const utterances = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "utterance_added") continue;
    const utterance = event.utterance;
    if (!isRecord(utterance) || typeof utterance.id !== "string" || typeof utterance.text !== "string" ||
        !Number.isInteger(utterance.seq) || !Number.isFinite(utterance.createdAt) ||
        !["manual", "replay", "web_speech", "external_stt"].includes(utterance.provider as string) || !(utterance.speaker === null || typeof utterance.speaker === "string") ||
        utterances.has(utterance.id)) return { valid: false, reason: "invalid_data" };
    utterances.set(utterance.id, utterance.text);
  }
  const reviewIds = new Set<string>();
  for (const event of events) {
    if (event.kind === "item_review") {
      if (!isRecord(event.event) || typeof event.event.id !== "string" ||
          reviewIds.has(event.event.id) || !hasValidArchivedItem(event.event.after) ||
          (event.event.before !== null && event.event.before !== undefined && !hasValidArchivedItem(event.event.before)) ||
          !["ItemAutoRecorded", "ItemHumanVerified", "ItemHeld", "ItemDismissed", "ItemCorrected",
            "ItemReviewReopened", "ItemWithdrawn", "ItemSuperseded", "ReviewActionReverted"].includes(event.event.action as string)) {
        return { valid: false, reason: "invalid_data" };
      }
      reviewIds.add(event.event.id);
    } else if (event.kind === "human_correction") {
      if (!isRecord(event.correction) || typeof event.correction.id !== "string" ||
          !isRecord(event.correction.target) || typeof event.correction.target.utteranceId !== "string" ||
          !isRecord(event.correction.axes)) return { valid: false, reason: "invalid_data" };
    } else if (event.kind === "human_confirmation" && typeof event.target !== "string") {
      return { valid: false, reason: "invalid_data" };
    } else if (event.kind === "human_rejection" && typeof event.target !== "string") {
      return { valid: false, reason: "invalid_data" };
    } else if (!["utterance_added", "item_review", "human_correction", "human_confirmation", "human_rejection"].includes(event.kind)) {
      return { valid: false, reason: "invalid_data" };
    }
  }
  if (events.some((event) => !hasValidReference(event, utterances))) {
    return { valid: false, reason: "corrupt_evidence" };
  }
  return { valid: true, archive: { ...parsed, stateConsistency: parsed.stateConsistency ?? {
    canonicalOnlyDecisions: [], dashboardOnlyDecisions: [],
  } } as unknown as MeetingArchive };
}

export function projectMeetingArchive(archive: MeetingArchive): ArchiveProjection {
  let canonical = createCanonicalState();
  const assertions: SemanticAssertion[] = [];
  const eventLog = { events: archive.events, nextSeq: Math.max(0, ...archive.events.flatMap((event) => event.kind === "utterance_added" ? [event.utterance.seq] : [])) + 1 };
  const utteranceEvents = archive.events.filter((event) => event.kind === "utterance_added");
  for (const event of utteranceEvents) {
    if (event.kind !== "utterance_added") continue;
    const utterance = event.utterance;
    const fastPath = runFastPath({ utterance, context: {
      ...emptyFastPathContext(),
      recentUtterances: recentUtterances({ events: utteranceEvents.filter((prior) =>
        prior.kind === "utterance_added" && prior.utterance.seq < utterance.seq), nextSeq: utterance.seq }, FAST_PATH_CONTEXT_WINDOW),
    } });
    assertions.push(...fastPath.assertions);
    canonical = reduceCanonical(canonical, { kind: "units_asserted", at: event.at, utterance, assertions: fastPath.assertions }).state;
    if (fastPath.relations.length) canonical = reduceCanonical(canonical, {
      kind: "relations_asserted", at: event.at, relations: fastPath.relations,
    }).state;
  }
  const verifiedIds = new Set<string>();
  for (const event of archive.events) {
    if (event.kind === "human_correction") canonical = reduceCanonical(canonical, event).state;
    else if (event.kind === "human_confirmation") canonical = reduceCanonical(canonical, {
      kind: "human_confirmation", at: event.at, entityId: event.target,
    }).state;
    else if (event.kind === "human_rejection") canonical = reduceCanonical(canonical, {
      kind: "human_rejection", at: event.at, entityId: event.target,
    }).state;
    else if (event.kind === "item_review") {
      if (["ItemHumanVerified", "ItemAutoRecorded"].includes(event.event.action)) verifiedIds.add(event.event.after.id);
      else if (event.event.action === "ReviewActionReverted" && event.event.reverts) {
        const reverted = archive.events.find((candidate) => candidate.kind === "item_review" &&
          candidate.event.id === event.event.reverts);
        if (reverted?.kind === "item_review" && ["ItemHumanVerified", "ItemAutoRecorded"].includes(reverted.event.action)) {
          verifiedIds.delete(event.event.after.id);
        }
      } else if (event.event.action === "ItemReviewReopened") verifiedIds.delete(event.event.after.id);
    }
  }
  for (const id of verifiedIds) {
    const entry = canonical.entries.find((candidate) => candidate.source.assertion.unit.id === id);
    if (entry && (entry.kind === "action" || entry.kind === "decision")) {
      canonical = reduceCanonical(canonical, { kind: "human_confirmation", at: archive.metadata.endedAt, entityId: entry.id }).state;
    }
  }
  return { assertions, canonical, timelineItems: projectMeetingMinutes(archive.id, canonical, eventLog).items };
}

export function toArchivedTranscript(segment: TimedTranscriptSegment): ArchivedTranscript {
  return {
    id: segment.id, text: segment.text, speaker: segment.speaker,
    startMs: segment.startMs, endMs: segment.endMs, confidence: segment.confidence,
  };
}
