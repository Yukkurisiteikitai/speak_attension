# 0024: realtime budgetを分割と合計の両方で測り、音声確定の遅延を境界flushで解消する

Date: 2026-09-28
Status: accepted

## 背景

[ADR 0023](0023-realtime-first-semantic-core-fast-and-refinement-paths.md) の
realtime監査で2点が未決のまま残った。

1. 最も増加が速い `buildMeetingProgress`（「流れ・次の検討」マップ）を
   budget対象に含めるかどうか。ADR 0023 では対象外にしていた。
2. 音声入力の確定遅延をどの段階で直すか。ADR 0023 ではPhase 2の対象としていた。

### 監査時の誤りの訂正

ADR 0023 の作業で作成した設計文書は、
「`flushBuffer` は `speech.stop()` 時にしか呼ばれない／遅延は不定」と記述していた。
**これは誤りだった。** `src/hooks/useTopicEngine.ts` に
`setInterval(() => store.flushBuffer(), SEGMENT_INTERVAL_MS = 5000)` の
定期flushが存在し、遅延は**最大5秒で有界**だった。
UIの「5秒バッファ」表示は正確だった。

結論（音声入力にrealtime性の欠落がある）は変わらない。
ingestは4.4ms、fast semantic budgetは150msである一方、
音声入力は発話確定から最大5000ms（budgetの33倍）segment化されなかった。
manual / replay は `submitTranscript` から直接 `processSegment` へ入るため
遅延がなく、**入力経路によってrealtime性が異なっていた**。
これは ADR 0023 §7 の「Manual / Replay / Web Speech / 将来STTを
同じnormalized utteranceへ入れる」に反する。

## 決定

### 1. budgetを分割と合計の両方で測る

ADR 0023 §10 の3段階に2段階を追加する。
閾値は `src/semantic/realtimeBudget.ts` の単一定義に置く。

| stage | budget | 位置づけ |
|---|---|---|
| timelineRender | 50ms | ADR 0023 の当初目標 |
| fastSemantic | 150ms | 同 |
| provisionalMeetingState | 200ms | 同 |
| **progressMapRender** | **100ms** | 本ADRで追加。当該パネルを開いている間のみ適用 |
| **totalVisibleUpdate** | **300ms** | 本ADRで追加。全パネル表示時に利用者が待つ合計 |

追加した2つの根拠:

- `progressMapRender` = 100ms。主役の画面ではなく任意に開くパネルなので、
  `provisionalMeetingState` の半分とする。
- `totalVisibleUpdate` = 300ms = 200 + 100。
  **分割した各段階がそれぞれのbudget内でも、合計が超える場合を検出するため。**
  段階を分割しただけでは、合計でしか現れない退行を隠せてしまう。
  ingestは段階ごとに二重計上せず、合計で1回だけ数える。

この2つは ADR 0023 の当初目標には無く、本ADRで新たに設定した値である。
実測に応じて調整してよい（budgetは保証値ではない）。

### 2. 音声確定の遅延を境界flushで解消する（Phase 1より先に実施）

**「final到着ごとに即処理する」方式は採らない。**
Web Speech の `isFinal` は文末ではなく認識チャンクの区切りであり、
文中で確定する。即処理すると1発話が複数segmentへ断片化し、
文単位を前提とする下流の分類器すべてのprecisionを落とす。
precision向上のための移行で逆にprecisionを落とすことになる。

採る方式は境界シグナルによるflushである。

| 条件 | flushまでの遅延 |
|---|---|
| 終端句読点（`。！？`）で終わるチャンク | 即時 |
| 無音が続いた場合 | 800ms |
| 話し続けている場合（backstop） | 5000ms（変更なし） |

- `です` / `ます` などの丁寧形語尾は境界として扱わない。
  Web Speechが文中でこの形を確定するため、境界にすると断片化する。
- 定期flushは `setInterval(5000)` から
  `setInterval(250)` での無音判定（`flushIfIdle`）へ変える。
  ポーリングはタイムスタンプ2つを読むだけである。
- 上限5000msは残す。句読点も無音も来ない話者でもsegment化されるようにするため。

実装は `src/hooks/topicEngineStore.ts` の `flushIfIdle` と
`src/hooks/useTopicEngine.ts` の定数3つに閉じる。

### 3. 推定と仮置きは統合したままとする

ADR 0023 §6 で `rule_inferred` を `provisional` へ統合した判断を維持する。
運用上同じ扱い（`decisions[]` / `actions[]` へ入れない）になるため、
区別を増やさない。必要になった時点で分割する。

## 帰結

- 音声入力の確定遅延が最大5000msから、通常800ms（句読点があれば即時）になる。
  fast semantic budget 150ms はまだ満たさないが、budgetの33倍から5倍へ縮む。
  完全な解消には Web Speech の chunk 境界の扱いを変える必要があり、
  ADR 0023 §7 の interim/final 契約の実装（Phase 2）で扱う。
- 1発話が複数segmentへ断片化しないことを維持する。
  この保証は `topicEngineStore.test.ts` の回帰テストで固定する。
- `progressMapRender` は現状のまま**budgetを超える**。
  実測で n≈1600 で 100ms を、`totalVisibleUpdate` は n≈3200 で 300ms を超える。
  これは既存の二次オーダー（`buildMeetingProgress` の `tree × graph` 入れ子）が
  原因であり、ADR 0023 の Phase 4 で解消する。
  **budgetを超えている事実をbenchmarkが報告し続けることを、解消までの可視化手段とする。**
- benchmarkは引き続きreportであり、testではない（常にexit 0）。
  CI環境のばらつきがあるため、hard flaky timing testにはしない。
