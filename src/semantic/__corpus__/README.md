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

`npm run semantic:eval` を実行して得られる実測値（20ケースの本コーパスに対して）：

| 指標 | 値 |
|---|---|
| 決定 precision | 20.0%（1/5） |
| 決定 recall | 50.0% |
| アクション precision | 25.0%（1/4） |
| アクション recall | 100.0% |
| unknown rate | 4.2% |

ADR 0022 の背景セクションは実会話由来の別コーパス（`demo/*.json` 等）に対する実測値として
「約1/6」と報告しているが、これは本20ケースコーパスの数値ではない。
本コーパスに対する実測値は上表の通りであり、`docs/tasks/semantic-core-phase0.md` の
「期待される実測値（参考）」もこの値を参照値として扱うこと。

legacy実装は、昇格した決定・アクションのうち相当数が false positive（本来はそのカテゴリではない項目）です。
これは設計上の選択ではなく、規則パターンの局所的な例外処理の積み重ねの結果です。

### 既知のFalse Positive（本コーパスで検出されるもの）

**決定への誤昇格:**

1. **ケース09:** 「対戦ゲーム形式を採用します」
   - 明示的決定（true positive）だが、同じ発話がアクションへも二重昇格する（下記参照）

2. **ケース11:** 「鈴木さんがプロトタイプを来週金曜日までに作成します」
   - アクション確約（true positive）だが、同じ発話が決定へも二重昇格する（ADR 0022記載の型誤り）

3. **ケース18:** 「本日の朝会を始めます。進捗報告をお願いします」
   - 会議進行の挨拶。語尾の「ます」で誤判定

4. **ケース19:** 「いい質問ですね。そこはまだ検討中です。青チームで検証します」
   - 明示的に「検討中」なのに「検証します」の語尾で誤判定

5. **ケース20:** 「今日は今四半期のロードマップを確定します」
   - 議題提示。語尾の「確定します」で誤判定

**アクションへの誤昇格:**

- ケース09、ケース18、ケース20（上記の決定側と同一発話が、二重昇格または語尾マッチでアクションにも入る）

ADR 0022 は同種の false positive を実会話由来の別コーパスから報告している
（例：「パフォーマンステストは本日中に完了します」）。この発話自体は本20ケースコーパスには
含まれていないため、`npm run semantic:eval` の出力には現れない。

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
