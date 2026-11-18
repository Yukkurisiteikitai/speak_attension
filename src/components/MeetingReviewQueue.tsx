import { useState, type FormEvent } from "react";
import { downloadFile } from "../lib/download";
import {
  itemFieldLabels, itemKindLabels, reviewActionLabels, reviewStateLabels, riskLabels, semanticStateLabels,
} from "../semantic/labels";
import { describeMinutesItem, exportMinutesJson, exportMinutesMarkdown, type MinutesMetadata } from "../semantic/meetingMinutesExport";
import { isInactive, type MeetingMinutes, type MinutesHistoryEntry } from "../semantic/meetingMinutesProjection";
import type { ItemCorrection, ItemFields, MeetingItem, ReviewAction, ReviewTarget } from "../semantic/meetingItem";
import { canBulkVerify, type ReviewResult } from "../semantic/reviewEventReducer";
import { formatReplayTime } from "../utils/transcriptReplay";
import type { MeetingArchiveSummary } from "../semantic/meetingArchiveStorage";

type Props = {
  minutes: MeetingMinutes;
  metadata: MinutesMetadata;
  onReview: (targets: ReviewTarget[], action: ReviewAction, bulk?: boolean) => Promise<ReviewResult>;
  saved: boolean;
  saveStatus: "saved" | "saving" | "dirty" | "failed" | "disabled";
  saveError: string | null;
  savedMeetings: MeetingArchiveSummary[];
  onSave: () => void;
  onListSaved: () => void;
  onRestore: (id: string) => void;
  onDeleteSaved: (id: string) => void;
};
const tabs = { pending: "要確認", held: "保留", recorded: "確定", history: "履歴" } as const;
type Tab = keyof typeof tabs;
const fieldKeys = Object.keys(itemFieldLabels) as Array<keyof ItemFields>;

function Evidence({ item }: { item: MeetingItem }) {
  return <div className="minute-evidence">
    {item.evidenceRefs.map((ref) => (
      <figure key={ref.utteranceId + ":" + ref.startOffset}>
        <figcaption>{ref.speakerId ?? "話者不明"} · {ref.elapsedMs === undefined
          ? new Date(ref.timestamp).toLocaleTimeString("ja-JP") : formatReplayTime(ref.elapsedMs) + "（再生位置）"}</figcaption>
        <blockquote>{ref.text}</blockquote>
      </figure>
    ))}
  </div>;
}

function History({ entries, currentIds, onOpen }: {
  entries: MinutesHistoryEntry[]; currentIds: Set<string>; onOpen: (id: string) => void;
}) {
  return entries.length ? <ol className="minute-history">
    {[...entries].reverse().map((event) => (
      <li key={event.id}>
        <details>
          <summary>{reviewActionLabels[event.action]} · {event.after.title}</summary>
          <p>{new Date(event.at).toLocaleString("ja-JP")} · {event.actor === "rule" ? "規則" : "操作担当者"}</p>
          <p>{event.reason}</p>
          {event.before && <p>変更前　{describeMinutesItem(event.before)}</p>}
          <p>変更後　{describeMinutesItem(event.after)}</p>
          <Evidence item={event.after} />
          {currentIds.has(event.after.id) &&
            <button type="button" onClick={() => onOpen(event.after.id)}>現在の項目を開く</button>}
        </details>
      </li>
    ))}
  </ol> : <p>変更履歴はありません。</p>;
}

function CorrectionForm({ item, onApply, onCancel }: {
  item: MeetingItem; onApply: (action: ReviewAction) => Promise<boolean>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ItemCorrection>({
    title: item.title, kind: item.kind, semanticState: item.semanticState, fields: item.fields,
  });
  const [reason, setReason] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const correction: ItemCorrection = {
      title: String(form.get("title") ?? "").trim(),
      kind: String(form.get("kind") ?? draft.kind) as ItemCorrection["kind"],
      semanticState: String(form.get("semanticState") ?? draft.semanticState) as ItemCorrection["semanticState"],
      fields: Object.fromEntries(fieldKeys.map((key) => [key, String(form.get(key) ?? "")])) as ItemFields,
    };
    if (await onApply({ kind: "ItemCorrected", correction, reason: String(form.get("reason") ?? "").trim() })) onCancel();
  };
  return <form className="minute-correction" onSubmit={submit}>
    <label>項目タイトル<input name="title" required value={draft.title} onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))} /></label>
    <label>種別<select name="kind" value={draft.kind} onChange={(event) => setDraft((previous) => ({ ...previous, kind: event.target.value as ItemCorrection["kind"] }))}>
      {Object.entries(itemKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>発言の意味<select name="semanticState" value={draft.semanticState} onChange={(event) => setDraft((previous) => ({ ...previous, semanticState: event.target.value as ItemCorrection["semanticState"] }))}>
      {Object.entries(semanticStateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    {fieldKeys.map((key) => <label key={key}>{itemFieldLabels[key]}
      <input name={key} value={draft.fields[key]} onChange={(event) => setDraft((previous) => ({ ...previous, fields: { ...previous.fields, [key]: event.target.value } }))} />
    </label>)}
    <label>訂正理由<textarea name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <div className="minute-actions">
      <button type="submit" className="primary-button">訂正を保存</button>
      <button type="button" onClick={onCancel}>キャンセル</button>
    </div>
  </form>;
}

export function MeetingReviewQueue({ minutes, metadata, onReview, saved, saveStatus, saveError, savedMeetings, onSave, onListSaved, onRestore, onDeleteSaved }: Props) {
  const [tab, setTab] = useState<Tab>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<MeetingItem[]>([]);
  const [preview, setPreview] = useState<MeetingItem[] | null>(null);
  const [editing, setEditing] = useState<ReviewTarget | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [feedback, setFeedback] = useState<ReviewResult & { message: string }>();
  const currentIds = new Set(minutes.items.map((candidate) => candidate.id));
  const rows = tab === "history" ? [] : minutes[tab];
  const item = minutes.items.find((candidate) => candidate.id === selectedId) ?? rows[0];
  const latest = item && minutes.history.filter((event) => event.after.id === item.id).at(-1);
  const canRevert = latest && ["ItemHeld", "ItemDismissed", "ItemHumanVerified", "ItemReviewReopened"].includes(latest.action) &&
    latest.after.revision === item?.revision;
  const bulkItems = checked.filter((candidate) =>
    minutes.pending.some((current) => current.id === candidate.id && current.revision === candidate.revision && canBulkVerify(current)));
  const previewIsCurrent = preview?.every((candidate) => bulkItems.some((current) => current.id === candidate.id));
  const select = (id: string) => { setSelectedId(id); setEditing(null); setShowHistory(false); };
  const openRelated = (id: string) => {
    const related = minutes.items.find((candidate) => candidate.id === id);
    if (!related) return;
    setTab(related.reviewState === "held" ? "held" : related.reviewState === "pending" ? "pending" :
      related.reviewState === "dismissed" ? "history" : "recorded");
    select(id);
  };
  const perform = async (targets: ReviewTarget[], action: ReviewAction, success: string, bulk = false) => {
    const result = await onReview(targets, action, bulk);
    if (result.ok && !bulk) setSelectedId(targets[0].id);
    setFeedback(result.ok ? { ok: true, message: success } : result);
    return result.ok;
  };

  return <section className="panel minutes-panel" aria-label="会議の議事録">
    <header className="minutes-heading">
      <div><p className="eyebrow">会議終了</p><h2>{metadata.title}の議事録</h2>
        <p><time>{new Date(metadata.startedAt).toLocaleString("ja-JP")}</time> 開始 · <time>{new Date(metadata.endedAt).toLocaleTimeString("ja-JP")}</time> 終了</p></div>
      <dl className="minute-counts">
        <div><dt>要確認</dt><dd>{minutes.pending.length}</dd></div>
        <div><dt>保留</dt><dd>{minutes.held.length}</dd></div>
        <div><dt>記録済み</dt><dd>{minutes.recorded.length}</dd></div>
      </dl>
    </header>
    <div className={`minute-save-status is-${saveStatus}`} role={saveStatus === "failed" ? "alert" : "status"}>
      <span>{saveStatus === "saved" ? "この端末に保存済み" : saveStatus === "saving" ? "保存中…" :
        saveStatus === "dirty" ? "未保存の変更あり" : saveStatus === "failed" ? saveError ?? "保存に失敗しました。" : "保存していません"}</span>
      {!saved && <button type="button" onClick={onSave} disabled={saveStatus === "saving"}>この端末に保存</button>}
      <button type="button" onClick={onListSaved}>保存済み会議を表示</button>
      <small>保存先はこの端末のブラウザー内です。暗号化やアクセス制御ではありません。外部送信・クラウド同期は行いません。</small>
    </div>
    <div className="workspace-tabs" aria-label="確認状態">
      {Object.entries(tabs).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key}
        onClick={() => { setTab(key as Tab); setSelectedId(null); setEditing(null); setShowHistory(false); setPreview(null); }}>
        {label}
      </button>)}
    </div>
    {feedback && <p className={feedback.ok ? "minute-feedback" : "minute-feedback is-error"} role={feedback.ok ? "status" : "alert"}>{feedback.message}</p>}
    {tab === "pending" && <>
      <div className="minute-actions">
        <button type="button" disabled={!bulkItems.length} onClick={() => setPreview([...bulkItems])}>一括確認のプレビュー（{bulkItems.length}件）</button>
      </div>
      {preview && <section className="minute-bulk" aria-label="一括確認の対象">
        <h3>記録上確定する項目</h3>
        <ul>{preview.map((candidate) => <li key={candidate.id}>{describeMinutesItem(candidate)}</li>)}</ul>
        {!previewIsCurrent && <p role="alert">対象が更新されました。プレビューを開き直してください。</p>}
        <div className="minute-actions">
          <button type="button" className="primary-button" disabled={!previewIsCurrent} onClick={async () => {
            if (await perform(preview, { kind: "ItemHumanVerified" }, `${preview.length}件を確定しました。`, true)) setChecked([]);
            setPreview(null);
          }}>一括で記録上確定</button>
          <button type="button" onClick={() => setPreview(null)}>閉じる</button>
        </div>
      </section>}
    </>}
    <div className="minutes-panes">
      <div className="minutes-list">
        {tab === "history" ? <History entries={minutes.history} currentIds={currentIds} onOpen={openRelated} /> :
          rows.length ? <ul>{rows.map((candidate) => <li key={candidate.id}>
            {canBulkVerify(candidate) && <input type="checkbox" aria-label={candidate.title + "を一括確認に選択"}
              checked={bulkItems.some((entry) => entry.id === candidate.id)} onChange={(event) => {
                const next = checked.filter((entry) => entry.id !== candidate.id);
                setChecked(event.target.checked ? [...next, candidate] : next);
                setPreview(null);
              }} />}
            <button type="button" aria-pressed={item?.id === candidate.id} onClick={() => select(candidate.id)}>
              <strong>{candidate.title}</strong>
              <small>{itemKindLabels[candidate.kind]} · リスク{riskLabels[candidate.riskLevel]} · {reviewStateLabels[candidate.reviewState]}</small>
            </button>
          </li>)}</ul> : <p>該当する項目はありません。</p>}
      </div>
      {item && <article className="minute-detail" aria-label="項目の詳細">
        <h3>{item.title}</h3>
        <p>{itemKindLabels[item.kind]} · {semanticStateLabels[item.semanticState]} · {reviewStateLabels[item.reviewState]} · リスク{riskLabels[item.riskLevel]}</p>
        <dl>{fieldKeys.filter((key) => item.fields[key]).map((key) => <div key={key}><dt>{itemFieldLabels[key]}</dt><dd>{item.fields[key]}</dd></div>)}</dl>
        <h4>根拠となる発言</h4>
        <Evidence item={item} />
        <h4>自動判定と確認理由</h4>
        <ul>{item.reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        {item.relatedIds.some((id) => minutes.items.some((candidate) => candidate.id === id)) && <div className="minute-actions">
          <span>関連項目</span>
          {item.relatedIds.map((id) => {
            const related = minutes.items.find((candidate) => candidate.id === id);
            return related && <button key={id} type="button" onClick={() => openRelated(id)}>{related.title}</button>;
          })}
        </div>}
        <div className="minute-actions">
          {["pending", "held"].includes(item.reviewState) && <button type="button" className="primary-button" disabled={!item.canVerify}
            onClick={() => void perform([item], { kind: "ItemHumanVerified" }, "記録上確定しました。")}>記録上確定</button>}
          {!isInactive(item) && item.reviewState !== "held" && item.reviewState !== "dismissed" && <button type="button"
            onClick={() => void perform([item], { kind: "ItemHeld" }, "保留にしました。")}>保留</button>}
          <button type="button" onClick={() => { setEditing(item); setShowHistory(false); }}>訂正</button>
          {!isInactive(item) && item.reviewState !== "pending" && <button type="button" onClick={() =>
            perform([item], { kind: "ItemReviewReopened" }, "再審査に戻しました。")}>
            {["auto_recorded", "human_verified"].includes(item.reviewState) ? "確定を取り消す" : "再審査に戻す"}
          </button>}
          {canRevert && <button type="button" onClick={() => void perform([item], { kind: "ReviewActionReverted" }, "直前の確認操作を取り消しました。")}>直前の操作を取り消す</button>}
          {item.reviewState === "pending" && <button type="button" onClick={() =>
            perform([item], { kind: "ItemDismissed" }, "議事録から除外しました。")}>除外</button>}
          <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>履歴を見る</button>
        </div>
        {editing?.id === item.id && <CorrectionForm key={item.id + ":" + editing.revision} item={item}
          onApply={async (action) => perform([editing], action, "訂正を保存しました。")} onCancel={() => setEditing(null)} />}
        {showHistory && tab !== "history" && <History entries={minutes.history.filter((event) => event.after.id === item.id)}
          currentIds={currentIds} onOpen={openRelated} />}
      </article>}
    </div>
    {savedMeetings.length > 0 && <details className="saved-meetings">
      <summary>保存済み会議</summary>
      <ul>{savedMeetings.map((meeting) => <li key={meeting.id}>
        <span>{meeting.title} · {new Date(meeting.endedAt).toLocaleString("ja-JP")}</span>
        <button type="button" onClick={() => onRestore(meeting.id)}>開く</button>
        <button type="button" onClick={() => onDeleteSaved(meeting.id)}>この端末から削除</button>
      </li>)}</ul>
    </details>}
    <details className="minute-preview">
      <summary>議事録プレビュー</summary>
      <div className="minute-actions">
        <button type="button" onClick={() => downloadFile("meeting-minutes.md", exportMinutesMarkdown(minutes, metadata), "text/markdown")}>Markdown 出力</button>
        <button type="button" onClick={() => downloadFile("meeting-minutes.json", exportMinutesJson(minutes, metadata), "application/json")}>JSON 出力</button>
      </div>
      <pre>{exportMinutesMarkdown(minutes, metadata)}</pre>
    </details>

  </section>;
}
