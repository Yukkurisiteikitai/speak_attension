# Semantic Corpus: Golden Expectations and Legacy Characterization

## 概要

このディレクトリは、意味解釈エンジンの回帰テストと評価のための「黄金コーパス」を管理します。

## 2種類のデータ

### Golden Expectations (`cases/*.json` の `expect` フィールド)

**意味:** 本来こうあるべき目標値。Phase 3で達成を目指す正しい出力

**テストでの扱い:**
- `npm run semantic:eval` が**数値として報告する**（スコア計測）
- テストの合格条件には使わない

### Characterization Snapshot (`characterization/legacy.snap.json`)

**意味:** 現状legacyが実際に出している値。正しさは主張しない

**テストでの扱い:**
- `npm run check` の合否判定に使う
- スナップショットと一致しなければテスト失敗

## 現状の実測値

### 決定のPrecision

**約17%（1/6）**

legacy実装は、昇格した決定のうち約5個が false positive（本来は決定ではない項目）です。
これは設計上の選択ではなく、規則パターンの局所的な例外処理の積み重ねの結果です。

### 既知のFalse Positive

以下4つは、Phase 0実測時に必ず検出されるべき false positive です：

1. **ケース18:** 「本日の朝会を始めます。進捗報告をお願いします」
   - 会議進行の挨拶。語尾の「ます」で誤判定

2. **ケース20:** 「今日は今四半期のロードマップを確定します」
   - 議題提示。語尾の「確定します」で誤判定

3. **ケース19:** 「いい質問ですね。そこはまだ検討中です。青チームで検証します」
   - 明示的に「検討中」なのに「検証します」の語尾で誤判定

4. **characterizationのみ:** 「パフォーマンステストは本日中に完了します」
   - 進捗報告。タスク完了の報告が決定と誤判定

### 既知の取りこぼし

以下は現状legacyが取りこぼすべき項目です：

1. **ケース10:** 「レイテンシー削減を優先で進めることにします」
   - 言い換えられた決定。`DECISION_PATTERN` が「ことにします」を含まない

2. **ケース06提案部:** 「対戦ゲーム形式で進めましょう」
   - 理由付き提案。提案部が抽出されない（理由だけが記録される）

## ファイル構成

```
__corpus__/
  README.md                        (このファイル)
  corpusTypes.ts                   ケースJSONの型定義
  loadCorpus.ts                    ケース読み込み関数（純粋関数）
  loadCorpus.test.ts               型適合性の検証
  generateCharacterization.ts      スナップショット生成スクリプト
  cases/
    01-topic-start.json
    02-agenda-item.json
    ... (20ケース全部)
  characterization/
    legacy.snap.json               現状の出力スナップショット
    legacyCharacterization.test.ts スナップショット同期テスト
```

## スナップショットについて

`legacy.snap.json` は現状legacyの正確な記録です。

**「正しい出力ではない」ことに注意してください。**

- false positiveを含む（上記「既知のFalse Positive」参照）
- 取りこぼしを含む（上記「既知の取りこぼし」参照）
- legacyロジックに1行の変更も加えずにそのままスナップショット化したもの

スナップショットは、Phase 0完了時の「現状を凍結する」ことが目的です。

## 評価の実行

```bash
npm run semantic:eval
```

出力：
- Console: 人間が読みやすい表
- `logs/semantic-eval-result.json`: 機械可読な結果

## Phase 0の成果

legacyロジックは一切変更されておらず、以下の3つの層が確立されました：

1. **Raw Utterance Log** — 唯一の一次資料
2. **Golden Corpus** — 本来あるべき正しい出力（現状は達成不可）
3. **Characterization Snapshot** — 現状legacyが出力している値

Phase 3でSemantic Coreへ移行する際、このコーパスと期待値が回帰テストの基準になります。
