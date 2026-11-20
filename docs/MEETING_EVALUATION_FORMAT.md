# 会議議事録評価データ形式

実会議データを追加するときは、音声・文字起こしの原本を別途保護し、このラベルデータには匿名化した発言IDと文字範囲を記録する。最低限、ケースごとに次を保持する。

```json
{
  "schemaVersion": 1,
  "meetingId": "匿名化した会議ID",
  "items": [
    {
      "id": "gold-1",
      "kind": "decision",
      "fields": { "content": "B案を採用", "owner": "", "deadline": "", "target": "B案", "condition": "" },
      "evidence": [{ "utteranceId": "u-12", "startOffset": 0, "endOffset": 9 }],
      "state": "agreed",
      "autoRecordAllowed": true,
      "humanReviewReasons": []
    }
  ],
  "events": [
    { "utteranceId": "u-13", "relation": "withdraws", "targetItemId": "gold-1" }
  ]
}
```

`state` は `agreed | unagreed | deferred | withdrawn | corrected` を使う。`autoRecordAllowed` は正解項目が自動記録されてよいかを示す。人間確認が必要なら `humanReviewReasons` に理由を付ける。各根拠は文字起こし上の半開区間 `[startOffset, endOffset)` とする。

False Commitment Rate は `誤って確定した項目数 ÷ 確定した項目総数` とする。自動確定を減らしただけの改善を避けるため、同時に抽出 Recall、自動確定率、人間確認が必要な件数も報告する。実会議データがない段階で精度改善を主張しない。
