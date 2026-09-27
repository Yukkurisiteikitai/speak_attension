# 作業指示書: Semantic Core Phase 1 — 型定義と sidecar parser

対象ADR: [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md)
前提: [Phase 0](semantic-core-phase0.md) が完了し、corpusとcharacterizationが存在すること
想定実行: クラウド（branch指定）／単独セッション

## 最初に読む

1. [AGENTS.md](../../AGENTS.md)
2. [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md) — §3〜§7が実装対象
3. [Phase 0指示書](semantic-core-phase0.md) の「2種類のデータ」
4. `src/semantic/__corpus__/README.md`（Phase 0の成果物）

## このPhaseの目的

Semantic Coreの型と parser を作り、**legacyと並列に走らせる（sidecar）**。
UIには一切出さない。legacyの出力を1バイトも変えない。

このPhaseが終わっても、ユーザーから見えるアプリの挙動は**完全に同一**である。

## 絶対にやらないこと

1. **legacyの出力を変えない。** Phase 0で作った
   `characterization/legacy.snap.json` が一致し続けること。これが唯一の安全網。
2. **Phase 0で列挙した既存分類ファイルを変更しない**
   （`utteranceClassification.ts` / `conversationTree.ts` / `meetingDecisionGraph.ts` /
   `meetingStateDashboard.ts` / `intentRules.ts` / `topicExtraction.ts` /
   `currentDiscussionState.ts`）。
   ただし `topicExtraction.ts` の `isFillerUtterance` と `splitIntoClauses` は
   **importして再利用してよい**（変更はしない）。
3. **UIコンポーネントを変更しない。** Timelineへの接続はPhase 2で行う。
4. **promotionPolicyをUIへ繋がない。** Phase 1では純粋関数とテストのみ。
5. **LLMを呼ばない。** parserが生成するassertionの `provenance` は `"rule"` 固定。
   `"model"` は型に存在するが、このPhaseでは生成しない（AGENTS.md の
   「リアルタイムのセグメント処理はルールベースを維持する」）。
6. **新しい依存パッケージを追加しない。**
7. **golden expectationを満たすために既存パターンを改造しない。**
   parserは新規実装であり、既存パターンのコピーではない。

## 成果物

```
src/semantic/
  types.ts                      Layer 1〜4の型（ADR 0022 §3〜§6）
  types.test.ts                 型レベルの不変条件（コンパイル時検証）
  rawUtterance.ts               RawUtterance / MeetingEvent の構築とイベントログ
  rawUtterance.test.ts
  segmentUnits.ts               発話 → 0..N SemanticUnit（span分割）
  segmentUnits.test.ts
  parseUnits.ts                 SemanticUnit → SemanticAxes（6軸の付与）
  parseUnits.test.ts
  resolveUnit.ts                assertion + human correction の解決
  resolveUnit.test.ts
  promotionPolicy.ts            Canonical Meeting State の生成（唯一の昇格地点）
  promotionPolicy.test.ts       不変条件 I1〜I14 の回帰テスト
  runSidecar.ts                 corpus/replayをcoreへ通す（純粋関数）
  runSidecar.test.ts
```

すべて `src/utils` と同じ規約に従う: **純粋関数**、併置した `*.test.ts`、
コメントは英語、UIラベルは日本語。

## 型定義（ADR 0022 の通りに実装する。勝手に変えない）

ADR 0022 の §3（Layer 1〜4）と §6（PromotionBasis）に定義がある。
以下は実装上の補足のみ。

- `SemanticUnit.span` は**原文の文字オフセット**（`Array.from` ベースではなく
  `string` のインデックス。JSのsurrogate pairに注意し、テストで日本語・絵文字を確認）。
- `SemanticUnit` は原文テキストを複製して持たない。表示用の文字列が必要な場合は
  `sliceUnitText(rawUtterance, unit)` のようなヘルパで導出する。
- `SemanticAssertion` は同一unitに対して複数保持できる配列として扱う。
  既存を削除・上書きしない。`supersedes` に履歴を積む。
- `RelationAssertion.basis === "proximity"` のとき
  `epistemic` は `"inferred"` 以上に強くできない（型ではなく関数で保証し、テストで検証）。

## segmentUnits の方針（ここが唯一の難所）

ADR 0022 §3「一発話一ラベルを禁止する」の実装。

**分割は控えめに行う。過剰分割より under-segmentation を選ぶ。**

1. まず `topicExtraction.splitIntoClauses`（既存・変更しない）で節候補を得る。
2. 節が意味的に独立している手がかり（下記）があるときのみ分割する:
   - 逆接の接続（`ただし` / `でも` / `一方で` / `けれど`）
   - 明示的な列挙（`1、` `2、` / `A、B、C`）
   - 因果マーカーを挟んだ前後（`〜ので、〜` / `〜なので、〜`）
3. 手がかりがなければ **発話全体を1 unit** とする（ADR 0022 §3のフォールバック）。
4. span は必ず元の発話を**連続かつ重複なく**覆うか、覆わない部分を残す。
   重複するspanを生成してはならない（テストで検証）。

Phase 0のケース06（`unitCount: 2`）と
ケース15（`unitCount: 3`）がこの機能の受け入れ基準である。
それ以外のケースで意図せず分割が増えていないことも確認する。

## parseUnits の方針

6軸を**独立に**判定する。1軸の判定結果を他軸の入力にしない。

- `scope`: 会議進行マーカー（議題・時間・順序・開始/終了）→ `meeting_process`。
  成果物マーカー（スライド・資料・構成・デモ・コード・ドキュメント）→ `artifact_content`。
  実質的な内容があれば `subject_matter`。それ以外 → `unknown`。
  **会議進行マーカーが成果物名より優先される**
  （「今日はスライド構成を決めます」は議題提示なので `meeting_process`）。
- `role` / `act` / `commitment`: ADR 0022 §3 の値域。
  `role === "decision"` を付けても `commitment` は独立に判定する（I11）。
- `epistemic`:
  - `explicit`: 明示マーカーが span 内に存在する
  - `inferred`: マーカーなしで内容語から推定した
  - `ambiguous`: 複数解釈が成立する、または判定根拠が無い
- `provenance`: 常に `"rule"`。

**既存の正規表現をコピーしない。** ADR 0022 の背景にある通り、
コピーが分岐して修正が片側にしか当たらないのが現在の障害原因である。
必要なパターンは `src/semantic/` 内に**単一の定義**として置き、
legacy側と共有もしない（legacyはPhase 6で削除する）。

判定できないときは強い値へ倒さず `unknown` / `other` / `ambiguous` を選ぶ。

## promotionPolicy の方針

**Canonical Meeting Stateを生成する唯一の場所。**
他のどのモジュールからもCanonical Stateを構築してはならない。

ADR 0022 §6 の不変条件 I1〜I14 を実装し、**14件それぞれに独立したテスト**を書く。
テスト名に不変条件IDを含める（例: `"I4: scope=meeting_process never promotes to actions"`）。

`decisions[]` の昇格ゲートはADR 0022 §6の論理式をそのまま実装する。
`します$` のような語尾のみの一致を「明示的決定マーカー」に含めてはならない。

昇格しなかったunitは捨てず `unresolved[]` へ入れる（I14）。

## runSidecar の方針

corpusのケースと replay JSON を入力として、
legacy と core の**両方**を走らせ、比較結果を返す純粋関数。

```ts
export type SidecarComparison = {
  caseId: string;
  legacy: { confirmedDecisions: string[]; nextActions: string[] };
  core: { decisions: string[]; actions: string[]; unresolved: number };
  goldenMet: boolean;
};
```

`npm run semantic:eval`（Phase 0で作成済み）を拡張して、
legacyとcoreの両方のスコアを並べて出力する。
**Phase 0で記録したlegacyのスコアが変化してはならない。**

## 完了条件

1. `npm run check` が緑。
2. `npm run build` が成功する（型定義がUIビルドを壊さないことの確認）。
3. **`characterization/legacy.snap.json` が無変更**（`git diff` で確認）。
   これが変わっていたらlegacyを壊している。
4. 不変条件 I1〜I14 に対応するテストが14件あり、すべて緑。
5. Phase 0ケース06が `unitCount: 2`、ケース15が `unitCount: 3` で分割される。
6. `npm run semantic:eval` が legacy と core を並べて出力し、
   **coreの決定false positiveが0件**である。
   （recallはlegacyより低くても構わない。precision優先 — ADR 0022 §7）
7. `git diff --stat` に「絶対にやらないこと」2で列挙したファイルが含まれない。
8. UIコンポーネント（`src/components/`）とフック（`src/hooks/`）に差分がない。

## 完了条件の優先順位

矛盾した場合の優先順位:

1. 条件3（legacyを壊していない）
2. 条件6のfalse positive 0件
3. 不変条件テスト14件
4. golden expectationの達成率

**4は最も低い。** goldenを満たすために1〜3を犠牲にしてはならない。
達成できなかったgoldenは、PR本文に「未達」として列挙して残す。

## PR

- タイトル: `feat: add semantic core types and sidecar parser (Phase 1)`
- 本文に必ず含める:
  - `npm run semantic:eval` の legacy / core 比較表
  - 不変条件テスト14件の一覧
  - **未達のgolden expectationの一覧と理由**（隠さない）
  - legacyとUIが無変更であることの明示
- `docs/STATE.md` に1段落追加する:
  Semantic Coreがsidecarとして並列実行されているが、
  UIには接続されておらず利用者から見た挙動は変わらないこと。

## 判断に迷ったら

- 分割すべきか迷ったら**分割しない**（1 unitにする）。
- 軸の値に迷ったら**弱い値**（`unknown` / `other` / `ambiguous`）を選ぶ。
- 昇格すべきか迷ったら**昇格させず** `unresolved[]` へ入れる。
- ADR 0022 と この指示書が矛盾する場合は **ADR 0022 が優先**。
  矛盾を見つけたらPR本文に記載する。
