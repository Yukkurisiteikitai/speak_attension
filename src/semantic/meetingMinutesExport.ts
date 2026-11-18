import type { MeetingItem } from "./meetingItem";
import type { MeetingMinutes } from "./meetingMinutesProjection";
import { itemFieldLabels, itemKindLabels, reviewActionLabels, reviewStateLabels, semanticStateLabels } from "./labels";

export type MinutesMetadata = { title: string; startedAt: number; endedAt: number };

const timestamp = (at: number) => new Date(at).toLocaleString("ja-JP");
const line = (text: string) => text.replace(/\s+/g, " ").trim().replace(/[\\`*_<>\[\]]/g, "\\$&");

export function describeMinutesItem(item: MeetingItem): string {
  return [item.title, itemKindLabels[item.kind], semanticStateLabels[item.semanticState], reviewStateLabels[item.reviewState],
    ...Object.entries(itemFieldLabels).flatMap(([key, label]) => {
      const value = item.fields[key as keyof MeetingItem["fields"]];
      return value && (key !== "content" || value !== item.title) ? [label + "：" + value] : [];
    })].join(" / ");
}

export function exportMinutesMarkdown(minutes: MeetingMinutes, metadata: MinutesMetadata): string {
  const metadataLines = [
    "# " + line(metadata.title) + " 議事録",
    `開始 ${timestamp(metadata.startedAt)} / 終了 ${timestamp(metadata.endedAt)}`,
    minutes.pending.length || minutes.held.length ? "**暫定版（未確認・保留事項あり）**" : "",
  ].filter(Boolean);
  const sections = [
    { title: "確定事項", items: minutes.recorded },
    { title: "確認待ち", items: minutes.pending },
    { title: "保留事項", items: minutes.held },
  ].map(({ title, items }) => [
    "## " + title, ...(items.length ? items.flatMap((item) => [
      "- " + line(describeMinutesItem(item)),
      ...item.evidenceRefs.map((ref) => `  - ${line(ref.speakerId ?? "話者不明")} ${timestamp(ref.timestamp)}「${line(ref.text)}」`),
    ]) : ["なし"]),
  ].join("\n"));
  const history = [
    "## 変更・撤回履歴",
    ...(minutes.history.length ? minutes.history.flatMap((event) => [
      `- ${timestamp(event.at)} ${event.actor === "rule" ? "規則" : "操作担当者"}：${reviewActionLabels[event.action]}（${line(event.reason)}）`,
      ...(event.before ? ["  - 変更前：" + line(describeMinutesItem(event.before))] : []),
      "  - 変更後：" + line(describeMinutesItem(event.after)),
      ...event.after.evidenceRefs.map((ref) => `  - 根拠：${line(ref.speakerId ?? "話者不明")} ${timestamp(ref.timestamp)}「${line(ref.text)}」`),
    ]) : ["なし"]),
  ].join("\n");
  return [...metadataLines, ...sections, history].join("\n\n") + "\n";
}

export function exportMinutesJson(minutes: MeetingMinutes, metadata: MinutesMetadata): string {
  return JSON.stringify({
    format: "meeting-minutes", version: 1, ...metadata,
    provisional: minutes.pending.length > 0 || minutes.held.length > 0,
    ...minutes,
  }, null, 2);
}
