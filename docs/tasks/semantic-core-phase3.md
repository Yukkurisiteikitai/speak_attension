# 引き継ぎ: Semantic Core Phase 3 — 会議状況の投影と判断記録

対象ADR: [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md)（§6 Promotion Policy、I1〜I14）
        [ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md)（Fast / Refinement 二系統）
設計の正本: [semantic-core-migration-design.md](semantic-core-migration-design.md)（§4 不変条件、§6.2 完了条件）
前提: [Phase 0](semantic-core-phase0.md)・[Phase 1](semantic-core-phase1.md) 完了

## 1. 状態（この PR 時点）

- ブランチ: `feature/semantic-core-phase3`（`main` から作成）
- 対象コミット: `29bdff7`
- 画面（`src/components/`, `src/hooks/`）は**未変更**。`meetingState` フラグは `false` のまま。
- `legacy.snap.json` は**未変更**。
- `npm run check`: 73 ファイル / 615 件 通過。
- `npm run semantic:diff`: legacy FP 7 件、core FP 0 件、新規 FP 0 件、受け入れ PASS。

## 2. このPhaseでやったこと

1. **投影** `src/semantic/meetingStateProjection.ts`
   - Canonical State を、確定決定・暫定決定・アクション・保留・質問・未解決・提案・選択肢・課題・話題・文脈のバケットに振り分ける。
   - 新しい判定はしない（表示用の形を作るだけ）。
   - 暫定決定は `provisionalDecisions` に入り、`confirmedDecisions` には入らない（I6）。
2. **テスト** `src/semantic/meetingStateProjection.test.ts`（6 件）
3. **診断** `scripts/diffSemanticPhase3.ts` / `npm run semantic:diff`
   - 20 ケースについて legacy と core の決定・アクションを比較し、`src/semantic/__corpus__/characterization/phase3-diff.json` に書き出す。
   - 報告であってテストではない（終了コードは常に 0）。
   - 設計 §6.2 が「各 Phase 終了時に `<phase>-diff.json` を保存する」と求めるため、この JSON はコミットに含める。
4. **誤検出の修正** `src/semantic/parseAxes.ts`
   - 「次回検討することにします」が決定になっていた（FP）のを、検討系マーカーに「検討することにします」「検討することにしました」を足して修正。
   - 回帰テストを `src/semantic/parseAxes.test.ts` に追加。

## 3. 決定の判定の仕組み（レビュー時の参照用）

ルールベースの正規表現のみ。LLM は使わない。

1. 文を節に分ける（`segmentUnits.ts:75` `segmentUnitSpans`）。
2. 節ごとに 6 軸を判定する（`parseAxes.ts:193` `parseAxes`）。明示マーカーがあれば `epistemic=explicit`。
3. 昇格ゲート（`promotionPolicy.ts:72-81`）: `act=decide` かつ `commitment=decided` かつ `scope≠meeting_process` かつ `epistemic=explicit` かつ `basis≠provisional` のときだけ決定。
   - ADR 0022 §6 の「span 内に明示的決定マーカー」と実質同じ条件。
4. 合わないものは提案・未解決などに振り分ける（I14: 捨てない）。

マーカーは `parseAxes.ts` の `DECISION_MARKERS`（40 行目付近）などに句単位の正規表現で定義している。

### 確認済みの挙動（scratchpad の probe で実行）

| 発話 | 結果 |
|---|---|
| 対戦ゲーム形式を採用します | 決定 |
| レイテンシー削減を優先で進めることにします | 決定 |
| 来週からこの形でいきましょう | 提案 |
| UIはダークモードにする方向で決めました | 未解決（リスト外の言い回しは安全側に倒れる） |
| 持ち帰ることにします | 未解決 |
| この件は次回検討することにします | 報告（修正後。修正前は決定だった） |
| その案は見送ることにします | 決定（**判断未決**。下記 §5） |

## 4. 測定の限界

- 一致判定は文字列の完全一致。span の切り方が違うだけで差分ありに見える。
- コーパスは 20 件で一部がダミー。`eval-data/` は git 管理外。**FP 0 は「このコーパスで 0 件」であり、実会議での保証ではない。**
- 見逃し（決定が未解決に落ちる割合）は、この 20 件では測れない。

## 5. 判断が必要な事項（未決）

1. **「見送ることにします」を決定に含めるか。** 現状は決定。見送りを「決定しないこと」と見るか「決定」と見るかは方針の問題。
2. **マーカー方式の実用性。** リストにない言い回しは未解決に落ちる。実会議の書き起こしで、人が決定と判断した文のうち何割が core で拾えるかを測る必要がある（§6 の 3）。
3. **画面接続で暫定決定をどう見せるか。** 暫定は `confirmedDecisions` に出さない（I6）が、表示の文言・位置は未決。

## 6. 次の作業（別 PR）

1. **画面接続**: 投影の出力を、`buildMeetingStateDashboard` が期待する `MeetingDecisionNode` 形式に変換し、`meetingState` フラグ付きで「会議の状況」画面に接続する。
   - 現在の接続点: `src/components/MeetingMode.tsx:86`（legacy の `topicEngine.decisionGraph` を入力にしている）。
2. **実会議での評価**: 書き起こしで、誤検出率と見逃し率を測る。
3. **Phase 4**: `decisionGraph` と `conversationTree` を投影にする。`buildMeetingProgress` の二次計算（発話 1600 件付近で予算超過）を解消する。

## 7. 既知の細かな問題

- `parseAxes.ts` の `DECISION_MARKERS` に「見送(?:ります|ります|る)」と「ります」の重複がある（動作には影響しない。整理は別途）。

## 8. 再現方法

```bash
npm run check          # 型チェック + 全テスト
npm run semantic:diff  # legacy と core の比較を phase3-diff.json に書き出す
```
