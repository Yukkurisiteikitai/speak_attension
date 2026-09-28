# 作業指示書: Semantic Core Phase 1 — 型定義と Fast Path sidecar parser

対象ADR: [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md)（意味モデル）
        [ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md)（realtime-first）
        [ADR 0024](../adr/0024-realtime-budget-stages-and-speech-boundary-flush.md)（budget段階・音声flush）
前提: [Phase 0](semantic-core-phase0.md) 完了（`src/semantic/__corpus__/` と `npm run semantic:eval` が存在する）
想定実行: クラウド（branch指定）／単独セッション

> **この指示書は2026-09-28に改訂された。** ADR 0023（realtime-first）により
> Phase 1 の範囲が変わっている。改訂前の版を参照しないこと。

## 最初に読む

1. [AGENTS.md](../../AGENTS.md)
2. [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md) — §3〜§7が実装対象
3. [ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md) — **§2〜§10が実装対象。0022より優先**
4. [ADR 0024](../adr/0024-realtime-budget-stages-and-speech-boundary-flush.md) — budget段階は5つ
5. `src/semantic/__corpus__/README.md`（Phase 0の成果物）
6. `src/semantic/realtimeBudget.ts` — budgetの単一定義

## このPhaseの目的

Semantic Core の型と **Fast Path** parser を作り、legacyと並列に走らせる（sidecar）。
UIには一切出さない。legacyの出力を1バイトも変えない。

このPhaseが終わっても、利用者から見たアプリの挙動は**完全に同一**である。

**Refinement Path は型と空の実行基盤だけ用意する。中身は実装しない**（Phase 5で稼働させる）。
Fast Pathが安定する前に非同期の競合解決をdebugしないため（ADR 0023 のPhase表）。

## 絶対にやらないこと

1. **legacyの出力を変えない。** `src/semantic/__corpus__/characterization/legacy.snap.json`
   がバイト単位で無変更であること。これが唯一の安全網。
2. **以下のファイルを変更しない。**
   `src/utils/utteranceClassification.ts` / `conversationTree.ts` /
   `meetingDecisionGraph.ts` / `meetingStateDashboard.ts` / `intentRules.ts` /
   `topicExtraction.ts` / `currentDiscussionState.ts`
   ただし `topicExtraction.ts` の `isFillerUtterance` と `splitIntoClauses` は
   **importして再利用してよい**（変更はしない）。
3. **UIコンポーネント・フックを変更しない**（`src/components/` `src/hooks/`）。
   Timelineへの接続はPhase 2で行う。
4. **LLMを呼ばない。** Fast Pathのassertionの `provenance` は `"rule"` 固定。
   `"model"` は型に存在するが、このPhaseでは生成しない。
5. **新しい依存パッケージを追加しない。**
6. **既存の正規表現をコピーしない。** コピーが分岐して片側にしか修正が当たらないのが
   現在の障害原因である（ADR 0022 背景）。必要なパターンは `src/semantic/` 内に
   **単一定義**として置き、legacy側と共有もしない。
7. **golden expectationを満たすために既存パターンを改造しない。**
8. **Canonical Stateをゼロから再構築する実装にしない**（ADR 0023 §5）。
9. **Fast Pathで会議全履歴を走査しない**（ADR 0023 §2・§4）。

## 成果物

```
src/semantic/
  types.ts                      Layer 1〜4の型（ADR 0022 §3〜§6 ＋ ADR 0023 §6〜§8）
  rawUtterance.ts               RawUtterance / MeetingEvent / TranscriptEvent
  rawUtterance.test.ts
  transcriptEvents.ts           interim/final の契約（ADR 0023 §7）
  transcriptEvents.test.ts
  segmentUnits.ts               発話 → 0..N SemanticUnit（span分割）
  segmentUnits.test.ts
  fastPath.ts                   Fast Path本体（ADR 0023 §2）
  fastPath.test.ts
  parseAxes.ts                  SemanticUnit → SemanticAxes（6軸）
  parseAxes.test.ts
  resolveUnit.ts                assertion + human correction の解決
  resolveUnit.test.ts
  promotionPolicy.ts            Canonical State 生成（唯一の昇格地点）
  promotionPolicy.test.ts       不変条件 I1〜I14 の回帰テスト
  canonicalReducer.ts           incremental reducer（ADR 0023 §5）
  canonicalReducer.test.ts
  refinementPath.ts             型と空の実行基盤のみ（中身は実装しない）
  refinementPath.test.ts        「未実装であること」を固定するテスト
  runSidecar.ts                 corpus/replayをcoreへ通す
  runSidecar.test.ts
```

すべて `src/utils` と同じ規約: **純粋関数**、併置した `*.test.ts`、
コメントは英語、UIラベルは日本語。

## 型定義

ADR 0022 §3〜§6 と ADR 0023 §5〜§8 の定義をそのまま実装する。勝手に変えない。
矛盾する箇所は **ADR 0023 が優先**。

### ADR 0022 から変わる点（ADR 0023 §6）

`PromotionBasis` は以下の3値にする。`rule_inferred` は作らない。

```ts
export type PromotionBasis = "provisional" | "rule_explicit" | "human_confirmed";
```

### 実装上の補足

- `SemanticUnit.span` は**原文の文字オフセット**。surrogate pair を含む文字列
  （絵文字など）でspanが壊れないことをテストで確認する。
- `SemanticUnit` は原文テキストを複製して持たない。表示用文字列は
  `sliceUnitText(rawUtterance, unit)` のようなヘルパで導出する。
- `SemanticAssertion` は同一unitに対し複数保持できる。既存を削除・上書きしない。
  `supersedes` に履歴を積む。
- `RelationAssertion.basis === "proximity"` のとき `epistemic` は
  `"inferred"` より強くできない。関数で保証しテストで検証する。
- Canonical State は `revision`（全体）と entity ごとの `entityRevision` を持つ
  （ADR 0023 §8）。
- **命名衝突の注意**: `src/semantic/__corpus__/corpusTypes.ts` が既に
  `SemanticUnit` という型名を export している。これは corpus の**期待値**の形であり、
  ランタイムの `SemanticUnit` とは別物である。
  `corpusTypes.ts` 側を `SemanticUnitExpectation` へ改名し、
  参照箇所（`loadCorpus.ts` / `loadCorpus.test.ts` / `evaluateCorpus.ts` など）を追随させる。
  これは corpus の**データ**を変えないので Phase 0 の成果を壊さない
  （`legacy.snap.json` とケースJSONは無変更のままにする）。

## Fast Path の仕様（ADR 0023 §2・§4）

```ts
export type FastPathInput = {
  utterance: RawUtterance;
  // 局所文脈のみ。会議全体を渡してはならない
  context: {
    activeTopicId: string | null;
    recentUtterances: RawUtterance[];      // rolling window
    recentlyReferencedEntityIds: string[];
  };
};

export type FastPathResult = {
  units: SemanticUnit[];
  assertions: SemanticAssertion[];
  // Fast Pathが張ってよい関係は明示マーカーのあるものだけ
  relations: RelationAssertion[];
};
```

- rolling window のサイズは `src/semantic/` 内の**定数1箇所**に置く。
  既定値は直近20発話とし、根拠をコメントに書く。
- Fast Pathは `context` に渡されたものしか見ない。
  引数として会議全体を受け取る関数シグネチャにしない（設計で禁止する）。
- Fast Pathが生成する関係は `basis: "explicit_marker"` のみ。
  `basis: "proximity"` の関係は **Refinement Pathの担当**なので生成しない。
- 判定できない軸は `unknown` / `other` / `ambiguous` を選ぶ。

## segmentUnits の方針（唯一の難所）

**分割は控えめに。過剰分割より under-segmentation を選ぶ。**

1. `topicExtraction.splitIntoClauses`（既存・変更しない）で節候補を得る。
2. 次の手がかりがあるときのみ分割する:
   - 逆接（`ただし` / `でも` / `一方で` / `けれど`）
   - 明示的な列挙（`1、` `2、` / `A、B、C`）
   - 因果マーカーを挟んだ前後（`〜ので、〜` / `〜なので、〜`）
3. 手がかりがなければ**発話全体を1 unit**とする。
4. spanは重複してはならない。テストで検証する。

受け入れ基準はPhase 0のケース06（`unitCount: 2`）とケース15（`unitCount: 3`）。
`getExpectedUnitCount()`（`corpusTypes.ts`）で期待値を解決する。
**それ以外のケースで意図せず分割が増えていないこと**も確認する。

## promotionPolicy の方針

Canonical Meeting Stateを生成する**唯一の場所**。
ADR 0022 §6 の不変条件 I1〜I14 を実装し、**14件それぞれに独立したテスト**を書く。
テスト名に不変条件IDを含める（例: `"I4: scope=meeting_process never promotes to actions"`）。

`decisions[]` の昇格ゲートはADR 0022 §6の論理式をそのまま実装する。
`します$` のような語尾のみの一致を「明示的決定マーカー」に含めてはならない。

`provisional` は `decisions[]` / `actions[]` へ入れない（I6）。
昇格しなかったunitは捨てず `unresolved[]` へ入れる（I14）。

## canonicalReducer の方針（ADR 0023 §5）

```ts
export type ReduceResult = { state: CanonicalMeetingState; changedEntityIds: string[] };
export type CanonicalReducer = (state: CanonicalMeetingState, event: SemanticEvent) => ReduceResult;
```

- 毎回ゼロから作らない。`byUtteranceId` / `byTopicId` の索引を持つ。
- 昇格判定は影響を受けたentityだけ再評価する。
- **昇格の判断地点を増やさない。** reducerはpromotionPolicyを呼ぶだけで、
  自前で昇格判定をしない。
- `revision` / `entityRevision` を更新する。
- テストで「同じeventを2回適用しても状態が変わらない（冪等）」ことを確認する。

## refinementPath の方針

**このPhaseでは中身を実装しない。** 用意するのは以下のみ。

- `RefinementJob` 型（ADR 0023 §8 の `basedOnRevision` / `readEntities` を含む）
- 結果適用時のrevision照合関数（`canApplyRefinement(job, state): boolean`）
- human correctionがあるentityへは適用しないことの保証

`refinementPath.test.ts` は「revision不一致なら適用しない」
「human correctionがあるentityには適用しない」の2点を固定する。
実際のreference解決・relation解決は実装しない。

## STT event contract（ADR 0023 §7）

`transcriptEvents.ts` に純粋関数として実装する。UIには繋がない。

- `interim` は preview を置き換えるだけ。`RawUtterance` を作らない。イベントログに入らない。
- `final` は `RawUtterance` をちょうど1件作る。
- 同一 `providerSeq` の `final` はそれまでの `interim` をすべて置き換える。
- `final` 後の同一 `providerSeq` の `interim` は破棄する。
- 同一 `providerSeq` への `final` 二重適用は冪等。

上記5点それぞれにテストを書く。

## 完了条件

1. `npm run check` が緑。
2. `npm run build` が成功する。
3. **`characterization/legacy.snap.json` が無変更**（`git diff` で確認）。
4. 不変条件 I1〜I14 に対応するテストが14件あり、すべて緑。
5. Phase 0ケース06が `unitCount: 2`、ケース15が `unitCount: 3` で分割される。
6. `npm run semantic:eval` が legacy と core を並べて出力し、
   **coreの決定false positiveが0件**。
   （recallはlegacyより低くても構わない。precision優先 — ADR 0022 §7）
7. **`npm run semantic:bench` で、同じ発話数における既存stageのbudget消費率を
   悪化させない。** sidecarはlegacyと並列に走るが、
   Phase 1では**legacyの同期パスへ挿入しない**ので、
   ingestの数値は変わらないはずである。変わっていたら挿入してしまっている。
   段階は5つある（ADR 0024）。`progressMapRender` と `totalVisibleUpdate` は
   **着手時点で既にbudgetを超えている**（二次オーダーが原因、Phase 4で解消）。
   Phase 1の条件は「超過を悪化させない」であり、「解消する」ではない。
   実行前に必ずbenchmarkを1回走らせ、着手時点の数値をPR本文に記録すること
   （実行環境ごとに絶対値が変わるため、他環境の数値と比較しない）。
8. `git diff --stat` に「絶対にやらないこと」2で列挙したファイルが含まれない。
9. `src/components/` と `src/hooks/` に差分がない。
10. Fast Pathの関数シグネチャが会議全体を受け取らない（`context` 経由のみ）。

## 完了条件の優先順位

矛盾した場合:

1. 条件3（legacyを壊していない）
2. 条件7（realtime budgetを悪化させていない）
3. 条件6のfalse positive 0件
4. 不変条件テスト14件
5. golden expectationの達成率

**5は最も低い。** goldenを満たすために1〜4を犠牲にしてはならない。
達成できなかったgoldenは、PR本文に「未達」として列挙して残す。

## PR

- タイトル: `feat: add semantic core types and fast-path sidecar parser (Phase 1)`
- 本文に必ず含める:
  - `npm run semantic:eval` の legacy / core 比較表
  - `npm run semantic:bench` の出力（Phase 0時点との比較）
  - 不変条件テスト14件の一覧
  - **未達のgolden expectationの一覧と理由**（隠さない）
  - legacyとUIが無変更であることの明示
- `docs/STATE.md` に1段落追加する:
  Semantic CoreがFast Path sidecarとして並列実行されているが、
  UIには接続されておらず利用者から見た挙動は変わらないこと。
  Refinement Pathは未実装であること。

## 判断に迷ったら

- 分割すべきか迷ったら**分割しない**（1 unitにする）。
- 軸の値に迷ったら**弱い値**（`unknown` / `other` / `ambiguous`）を選ぶ。
- 昇格すべきか迷ったら**昇格させず** `unresolved[]` へ入れる。
- Fast PathとRefinement Pathのどちらに置くか迷ったら **Refinement Path**。
  Fast Pathは小さく保つ。
- ADR 0022 と ADR 0023 が矛盾する場合は **ADR 0023 が優先**。
- ADRと この指示書が矛盾する場合は **ADRが優先**。
  矛盾を見つけたらPR本文に記載する。
