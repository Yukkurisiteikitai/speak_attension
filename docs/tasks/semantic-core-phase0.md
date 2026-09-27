# 作業指示書: Semantic Core Phase 0 — golden corpus と characterization tests

対象ADR: [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md)
想定実行: クラウド（branch指定）／単独セッション
前提知識: なし（この指示書だけで完結する）

## 最初に読む

1. [AGENTS.md](../../AGENTS.md) — Hard constraints と Verify
2. [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md) — 背景と決定事項
3. この指示書

## このPhaseの目的

**既存の振る舞いを凍結すること。** 意味解釈の実装は一切行わない。

Phase 1以降でロジックを触る前に、
「現状が何を出力しているか」と「本来何を出力すべきか」を
別々のデータとして固定する。

## 絶対にやらないこと

この5点はこのPhaseの成否を決める。違反した場合はPhase 0は失敗とみなす。

1. **既存の分類ロジックを1行も変更しない。**
   以下のファイルを変更してはならない:
   - `src/utils/utteranceClassification.ts`
   - `src/utils/conversationTree.ts`
   - `src/utils/meetingDecisionGraph.ts`
   - `src/utils/meetingStateDashboard.ts`
   - `src/utils/intentRules.ts`
   - `src/utils/topicExtraction.ts`
   - `src/utils/currentDiscussionState.ts`

2. **正規表現に例外規則を追加しない。**
   この移行はそもそも「局所的な例外規則の追加を止める」ために行う。
   corpusのgolden expectationを満たすために既存パターンを調整することは、
   このPhaseの目的と正反対である。

3. **golden expectationをテストの合格条件にしない。**
   golden（`expect`）は「本来こうあるべき」という**将来の目標値**である。
   現状のlegacyはこれを満たさない。満たさないのが正しい。
   失敗するテストとして登録してはならない（詳細は後述の「2種類のデータ」）。

4. **LLM・クラウドAPI・新しい依存パッケージを追加しない。**
   `package.json` の dependencies / devDependencies を変更しない。

5. **既存ADRを書き換えない。** 新しいADRも追加しない（Phase 0では不要）。

## 2種類のデータ（ここを混同すると全部やり直しになる）

| 種類 | 置き場所 | 意味 | テストでの扱い |
|---|---|---|---|
| **golden expectation** | `cases/*.json` の `expect` | 本来こうあるべき目標値。Phase 3で達成する | **合否判定に使わない。** スコア計測のみ |
| **characterization snapshot** | `characterization/*.snap.json` | 現状legacyが実際に出している値。正しさは主張しない | **合否判定に使う。** 一致しなければ失敗 |

つまり:
- `npm run check` が緑になる条件は **characterization snapshotと一致すること**。
- goldenとの乖離は `npm run semantic:eval` が**数値として報告する**だけ。

現状のlegacyはgoldenに対して決定precisionが約1/6である。
eval実行時にそう出るのが**期待される正しい結果**である。

## 成果物

```
src/semantic/
  __corpus__/
    README.md                        各ケースの意図と「なぜその期待値か」
    corpusTypes.ts                   ケースJSONの型
    loadCorpus.ts                    ケース読み込み（純粋関数）
    loadCorpus.test.ts               全ケースが型に適合することの検証
    cases/
      01-topic-start.json
      ... (下表の20ケース)
    characterization/
      legacy.snap.json               現状legacyの出力スナップショット
      legacyCharacterization.test.ts スナップショットとの一致検証
  evaluateCorpus.ts                  legacy評価（純粋関数）
  evaluateCorpus.test.ts
scripts/
  evaluateSemanticCorpus.ts          npm run semantic:eval のエントリ
```

`package.json` の `scripts` に1行だけ追加する（dependenciesは触らない）:

```json
"semantic:eval": "tsx scripts/evaluateSemanticCorpus.ts"
```

## ケースJSONの形式

```jsonc
{
  "id": "01-topic-start",
  "intent": "議題提示を決定・アクションへ昇格させない",
  "coverage": "topic start",
  "utterances": [
    { "text": "今日はイベント形式について決めます", "speaker": "ファシリテーター" }
  ],
  "expect": {
    // Canonical Meeting Stateの件数。これが主。
    "canonical": { "decisions": 0, "actions": 0, "proposals": 0, "unresolved": 0 },
    // unitの軸。これは従（軸名は移行中に変わり得る）。
    "units": [
      { "scope": "meeting_process", "role": "topic", "act": "topic_start", "commitment": "none" }
    ],
    // 一発話一ラベル禁止の検証に使う。省略時は1。
    "unitCount": 1
  },
  "notes": "scopeがmeeting_processなので不変条件I4により決定・アクションへ入らない"
}
```

`expect.canonical` に書かない項目は「検証対象外」を意味する。0を明示した項目だけが
false positive判定の対象になる。

## 作成するケース一覧（20件・すべて必須）

`coverage` 列の値はそのままJSONの `coverage` フィールドに入れる。
発話はできるだけ `demo/*.json` と既存テストの実発話を使う。

| id | coverage | 発話 | 必須の期待値 |
|---|---|---|---|
| 01-topic-start | topic start | 今日はイベント形式について決めます | `decisions:0, actions:0` / `scope: meeting_process` |
| 02-agenda-item | agenda item | 今日整理したいことは3つ、スライド作成、コーディング、リファクタリングです | `actions:0, decisions:0` / `role: agenda_item` |
| 03-context | context | スライドの構成のベースはまず決まっていて、問題、解決へのプロセス、解決策のデモ、今後 | `decisions:0` / `role: context` |
| 04-option-enumeration | option enumeration | 方法としてA、B、Cがあります | `proposals:0, decisions:0` / `role: option`, `act: enumerate`, `commitment: mentioned` |
| 05-personal-consideration | personal consideration | 個人的に考えているのが1、私は今までどんな情報があってどんな優先順位をつけて行動を | `actions:0, decisions:0` / `commitment: considered` |
| 06-proposal-with-reason | proposal | スマホで集客しやすいので、対戦ゲーム形式で進めましょう | `proposals:1, decisions:0` / **`unitCount: 2`**（reason + proposal） |
| 07-support | support | それでいきましょう | `decisions:0` / `act: advocate`, `commitment: accepted` |
| 08-opposition | opposition | それは反対です。コストが見合いません | `decisions:0` / `act: oppose`, `commitment: rejected` |
| 09-decision-explicit | decision | 対戦ゲーム形式を採用します | `decisions:1` / `act: decide`, `commitment: decided` |
| 10-decision-paraphrased | decision（言い換え） | レイテンシー削減を優先で進めることにします。期限は10月末です | `decisions:1` / 現状legacyは取りこぼす |
| 11-action-commitment | action commitment | 鈴木さんがプロトタイプを来週金曜日までに作成します | `actions:1, decisions:0` / owner・deadline抽出、二重昇格禁止（I13） |
| 12-deferred | deferred idea | ランキング機能については、保留にしておきましょう | `deferred:1, decisions:0, actions:0` / `act: defer` |
| 13-acknowledgement | acknowledgement | そうですね | 全カテゴリ0 / `role: acknowledgement` |
| 14-rhetorical-question | rhetorical question | このステップが完了することは何を意味するか | `questions:1, decisions:0` / `act: ask` |
| 15-multi-meaning | long multi-meaning | 昨日のスプリントタスクは完了しました。ただし、APIレスポンスが予想より遅くて、パフォーマンステストをやり直す必要があります | **`unitCount: 3`**（report / problem / proposal）, `decisions:0` |
| 16-reference-unresolved | reference expression | それで進めましょう | `decisions:0` / 参照解決不能なら関係は `unresolved` |
| 17-topic-return | topic change / return | 話を戻すと、Wi-Fi負荷の件ですが | `scope: meeting_process` / 前話題の根拠を引き継がない |
| 18-process-greeting | 会議進行の挨拶 | 本日の朝会を始めます。進捗報告をお願いします | `decisions:0, actions:0` / **現状false positive** |
| 19-explicitly-undecided | 明示的な検討中 | いい質問ですね。そこはまだ検討中です。青チームで検証します | `decisions:0` / **現状false positive** |
| 20-agenda-paraphrased | 議題提示の言い換え | 今日は今四半期のロードマップを確定します | `decisions:0, actions:0` / **現状false positive**。`docs/STATE.md` の保証 |

複数発話が必要なケース（07 / 08 / 16 / 17）は、
先行する提案・話題の発話を `utterances` に含めて文脈を作る。
例: 07 は「対戦ゲーム形式で進めましょう」→「それでいきましょう」の2発話。

### ケース16と17の注意

`それ` / `これ` の参照先を推測してはならない。
参照解決ができない場合に `unresolved` になることを検証するケースである。
「正しく解決できること」を期待値にしない。

## characterization snapshot の作り方

corpusの全発話について、現状legacyの出力をそのまま記録する。

記録する内容（発話ごと）:

| キー | 取得方法 |
|---|---|
| `timeline` | `classifyUtterance(text)` の全フィールド |
| `tree` | `classifyConversationRole(text, true)` |
| `intent` | `detectUtteranceIntent(text)` |
| `decisionNodeTypes` | `appendMeetingDecisionSegment` を空グラフへ適用し、`type !== "utterance"` のノード型の配列 |

さらにケースごと（発話列を順に投入したあと）:

| キー | 取得方法 |
|---|---|
| `confirmedDecisions` | `buildMeetingStateDashboard(graph, [], null).confirmedDecisions` のlabel配列 |
| `nextActions` | 同 `.nextActions` の `{ what, owner, deadline }` 配列 |
| `structuralGaps` / `unresolvedItems` | 件数 |

`AnalyzedSegment` は `analysis` フィールドを持つが、
`appendMeetingDecisionSegment` は `analysis` を参照しない。
テスト用セグメントは `analysis` を空オブジェクトにキャストして構築してよい
（`src/utils/meetingDecisionGraph.test.ts` に既存の書き方があれば従う）。

スナップショットは**手書きせず、スクリプトで生成してコミットする**。
生成後、内容を目視し、README に「このスナップショットは現状の記録であり、
正しい出力ではない」と明記する。

## evaluateCorpus の仕様

純粋関数として実装する（副作用・ファイルI/Oはエントリスクリプト側）。

```ts
export type CorpusEvaluation = {
  decisionPrecision: number;   // 正しく昇格した決定 / 昇格した決定の総数
  decisionRecall: number;
  actionPrecision: number;
  actionRecall: number;
  unknownRate: number;
  falsePositives: Array<{ caseId: string; category: "decision" | "action"; label: string }>;
};
```

`npm run semantic:eval` は上記を表として標準出力へ出す。
**falsePositives が1件以上あってもスクリプトは失敗させない**（Phase 0では現状の記録が目的）。
Phase 3以降で閾値を導入するため、数値は機械可読な形（JSON）でも出す。

出力先: `logs/` は `.gitignore` 対象なので、
比較結果のコミットが必要な場合は `src/semantic/__corpus__/characterization/` へ置く。

## 完了条件

1. `npm run check` が緑。
2. ケースが20件あり、`loadCorpus.test.ts` で全件が型に適合する。
3. `coverage` の値が20種すべて揃っている（重複・欠落なし）。テストで検証する。
4. `npm run semantic:eval` が実行でき、決定・アクションのprecision/recallと
   false positive一覧を出力する。
5. `git diff` に「絶対にやらないこと」1で列挙したファイルが**含まれない**。
6. `package.json` の差分が `scripts` の1行追加のみ。
7. `src/semantic/__corpus__/README.md` に以下を書く:
   - goldenとcharacterizationの違い
   - 現状の決定precision実測値
   - 「characterizationは現状の記録であり正しい出力ではない」

## 期待される実測値（参考）

Phase 0完了時、`npm run semantic:eval` は概ね次を報告するはずである。
大きく外れる場合は集計方法を疑うこと。

- 決定 precision: 約 0.17（1/6前後）
- 現状false positiveとして必ず検出されるべきもの:
  - 本日の朝会を始めます。進捗報告をお願いします（ケース18）
  - 今日は今四半期のロードマップを確定します（ケース20）
  - いい質問ですね。そこはまだ検討中です。青チームで検証します（ケース19）
  - パフォーマンステストは本日中に完了します（characterizationにのみ登場）
- 現状取りこぼすべきものとして検出されるもの:
  - レイテンシー削減を優先で進めることにします（ケース10）
  - 対戦ゲーム形式で進めましょう（ケース06の提案）

## PR

- タイトル: `test: add semantic core golden corpus and legacy characterization (Phase 0)`
- 本文に必ず含める:
  - `npm run semantic:eval` の出力（表）
  - 「legacyロジックは無変更」であることの明示
  - goldenとcharacterizationの違いの1段落説明
- `docs/STATE.md` は更新しない（実装状態は変わっていない）。

## 判断に迷ったら

- 期待値が決められない発話は、**ケースに含めない**のではなく
  `expect.canonical` を最小限（`decisions: 0` だけ等）にして含める。
- 軸の値が決められない場合は `expect.units` を省略し、`canonical` だけ書く。
- 「強い分類に倒すか迷う」場合は必ず弱い方（`unknown` / `other` / `unresolved`）を選ぶ。
  ADR 0022 の「false positiveよりunknownを優先する」に従う。
