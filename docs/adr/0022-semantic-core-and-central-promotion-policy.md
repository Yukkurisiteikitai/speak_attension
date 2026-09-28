# 0022: 意味解釈をSemantic Coreへ中央集約し、昇格を単一のPromotion Policyに限定する

Date: 2026-09-28
Status: accepted

## 背景

同一の発話について、複数のモジュールが独立に意味解釈を行っている。
設計判断の前に実測した（`demo/*.json` と実会話由来の発話を既存エンジンへ投入）。

### 同一発話に対する複数の世界観

| 発話 | Timeline (`utteranceClassification`) | Tree (`conversationTree`) | Decision Graph (`meetingDecisionGraph`) |
|---|---|---|---|
| 個人的に考えているのが1、私は今までどんな情報があって | `option` / `considered` | `action` | （なし） |
| スマホで集客しやすいので、対戦ゲーム形式で進めましょう | `reason` / `mentioned` | `statement` | `reason` のみ（提案が消える） |
| 対戦ゲーム形式を採用します | `other` / `none` | `statement` | `decision` + `action` |
| パフォーマンステストは本日中に完了します | `other` / `none` | `statement` | `decision` + `action` |
| レイテンシー削減を優先で進めることにします | `other` / `none` | `statement` | （なし） |
| 了解です。今日中に確認取ります | `agenda_item` | `statement` | （なし） |

### Canonical Meeting Stateへの昇格精度

`appendMeetingDecisionSegment` → `buildMeetingStateDashboard` で
「今決まっていること」へ昇格した項目（`demo/*.json`）:

| corpus | 昇格した項目 | 判定 |
|---|---|---|
| quick-standup | 本日の朝会を始めます。進捗報告をお願いします | false positive（会議進行の挨拶） |
| quick-standup | パフォーマンステストは本日中に完了します | false positive（進捗報告） |
| product-roadmap | 今日は今四半期のロードマップを確定します | false positive（議題提示） |
| product-roadmap | いい質問ですね。そこはまだ検討中です。青チームで検証します | false positive（明示的に「検討中」） |
| event-planning | 対戦ゲーム形式を採用します | true positive |
| event-planning | 鈴木さんがプロトタイプを来週金曜日までに作成します | 型誤り（decisionとactionへ二重昇格） |

確定決定の precision は約 1/6。同時に実在する決定
（レイテンシー削減を優先 / UI刷新は見送り）を取りこぼす。
`来週金曜日までに` の期限抽出は Timeline 側が成功し Decision Graph 側が失敗する
（同一発話の同一属性で2エンジンが不一致）。

### 文書化済みの保証が破れている

`docs/STATE.md` は「議題開始の『今日は〜について決めます』は決定済みアクションにしない」
と保証するが、`今日は今四半期のロードマップを確定します` は決定済みアクションへ昇格する。
`BOUNDARY_PATTERN` が `について(?:決めます|…)` という字面を要求するため、
言い換えで保証が無効化され `DECISION_PATTERN` の `します$` に落ちる。

### 重複した解釈の実態

| 意味概念 | 独立した定義箇所 | 状態 |
|---|---|---|
| 質問 | `meetingDecisionGraph`, `utteranceClassification`, `intentRules` | 前2つはバイト単位で同一のコピー |
| 根拠 | `meetingDecisionGraph`, `utteranceClassification` | バイト単位で同一のコピー |
| アクション | `conversationTree`, `utteranceClassification`, `meetingDecisionGraph`, `intentRules` | 前2つは同一由来だが `(?<!今)` 修正が片方だけ／3つ目は同名で別概念 |
| 課題 / 理由 / 提案 / 話題境界 | 各3〜4系統 | 閾値が異なる |
| 担当・期限 | `meetingDecisionGraph` インライン, `utteranceClassification` | 実測で結果が不一致 |

`(?<!今)` の片側適用は実害として観測済み（`私は今までどんな情報が…` が Tree で `action`）。
1箇所直してもコピーが残る限り再発する。

局所例外規則の追加では解決しない。規則を1本足すたびに、
保証は「その字面でのみ成立する保証」に縮む。

## 決定

### 1. 4層に分離し、上の層は下の層を書き換えない

```
Input Provider
→ Raw Utterance Event Log   (Layer 1: 唯一の一次資料)
→ Semantic Units            (Layer 2: 0..N per utterance)
→ Semantic Assertions       (Layer 3: machine出力はFactではない)
→ Promotion Policy          (Layer 4: 昇格はここだけ)
→ Canonical Meeting State
→ Projections               (Tree / Graph / Timeline / Dashboard / Report)
```

### 2. Raw utteranceを唯一の一次資料とする

原文・時刻・話者・入力sourceを保持し、append-onlyのイベントログに積む。
Manual / Replay / Web Speech / 将来のSTTは、すべて同一の
`RawUtterance` / `InputProviderKind` へ正規化して入る。
再解析はログを消費するだけで、ログを書き換えない。

### 3. 一発話一ラベルを禁止する

1発話は 0..N の semantic unit へ分割できる。
unit は原文への span 参照（文字オフセット）で表し、原文を複製しない。
分割が判定できない場合は発話全体を1 unitとする。

以下6つを直交概念として保持する。1軸の値が他軸を含意してはならない。

- `scope`: `meeting_process` / `subject_matter` / `artifact_content` / `unknown`
- `role`: `topic` / `agenda_item` / `context` / `problem` / `reason` / `evidence` / `option` / `proposal` / `decision` / `action` / `question` / `acknowledgement` / `other`
- `act`: `topic_start` / `enumerate` / `report` / `ask` / `suggest` / `advocate` / `oppose` / `decide` / `commit` / `defer` / `acknowledge` / `other`
- `commitment`: `none` / `mentioned` / `considered` / `proposed` / `accepted` / `decided` / `committed` / `deferred` / `rejected`
- `epistemic`: `explicit` / `inferred` / `ambiguous`
- `provenance`: `rule` / `model` / `human`

`role: "decision"` は `commitment: "decided"` を含意しない。昇格はLayer 4の責務である。

### 4. machine出力はAssertionとして保持する

同一unitに対して競合する複数の主張を保持でき、上書きしない
（`supersedes` で履歴を残す）。関係推定もAssertionとして保持する。

- `basis: "proximity"` の関係は `epistemic: "inferred"` を超えられない。
  **近接だけで因果をconfirmedにしない。**
- 関係が確定するのは `basis: "human"` または `basis: "explicit_marker"` のときのみ。
- `relation: "unresolved"` を正式な値として許可する（関係不明を関係なしと混同しない）。

既存の `provenance.createdBy: "human"` を規則出力へ付けている箇所
（`meetingDecisionGraph.ts`、`design-hinge/graph/utteranceIngestion.ts` の
`origin: "human"` / `provenance: "human"`）は、規則出力を人間発言として
偽装しているため `"rule"` へ訂正する。

### 5. human correctionをfirst-class eventとして保存する

`human_correction` はイベントログに積む。軸ごとの部分上書きと再分割を表現でき、
指定しない軸はmachine推定のまま残す。

解決規則:
1. `provenance: "human"` のcorrectionがある軸は常にそれを採用する。
2. 残りはmachine assertionからconfidence最大、同値なら新しい方。
3. 再解析はmachine assertionのみを置換し、correctionは保持する。

**human correction > machine inference を型と解決規則で保証する。**
再解析でhuman overrideを上書きしない。

### 6. 昇格は単一のPromotion Policyだけが行う

`src/semantic/promotionPolicy.ts` のみが Canonical Meeting State を生成する。
昇格結果は `basis` を必ず持つ。

- `human_confirmed`: 人が確認した
- `rule_explicit`: 明示マーカーのある規則判定
- `rule_inferred`: 推定のみ（`decisions`/`actions` へは入れない）

`basis` を型に持たせることで、UIは「規則が言っている」と「人が確認した」を
区別せずに描画できない（[ADR 0018](0018-meeting-state-primary-surface-and-epistemic-boundaries.md) の要求を型で強制する）。

以下をarchitecture invariantとし、各項目に回帰テストを持つ。

| ID | 不変条件 | 述語 |
|---|---|---|
| I1 | option != proposal | `role==="option"` は `proposals[]` に入らない |
| I2 | proposal != decision | `commitment ∈ {mentioned, considered, proposed}` は `decisions[]` に入らない |
| I3 | proposal != action | `role==="proposal"` は `actions[]` に入らない |
| I4 | agenda item != action | `scope==="meeting_process"` は `decisions[]`/`actions[]` に入らない |
| I5 | topic != proposal | `act==="topic_start"` は `proposals[]`/`decisions[]`/`actions[]` に入らない |
| I6 | machine inference != human-confirmed fact | `epistemic!=="explicit"` の昇格は `basis!=="human_confirmed"` |
| I7 | system suggestion != decision | `DecisionMaterial` は `decisions[]` に入らない |
| I8 | ambiguousを強分類しない | `epistemic==="ambiguous"` は `unresolved[]` のみ |
| I9 | deferred != decided | `commitment==="deferred"` は `deferred[]` のみ |
| I10 | report != decision | `act==="report"` は `decisions[]` に入らない |
| I11 | commitmentはroleから独立 | `role==="decision"` 単独では昇格しない |
| I12 | 近接は因果を確定しない | `basis==="proximity"` は `rule_inferred` を超えない |
| I13 | 二重昇格の禁止 | 同一発話が `decisions[]` と `actions[]` に同時に入るのは独立したunitがあるときのみ |
| I14 | false positiveよりunknown | どの分岐にも合致しなければ `unresolved[]` へ入れる（捨てない） |

`decisions[]` の昇格ゲート:

```
昇格する ⟺ act==="decide"
          ∧ commitment==="decided"
          ∧ scope!=="meeting_process"
          ∧ epistemic==="explicit"
          ∧ ( basis==="human_confirmed" ∨ span内に明示的決定マーカーが存在 )
```

`します$` のような語尾だけの一致は「明示的決定マーカー」に含めない。
これが背景で実測した4件のfalse positiveを構造的に塞ぐ。

### 7. unknownを正式に許可する

`unknown` / `other` / `unresolved` を正式な値として許可する。
ambiguousな入力を強分類しない。**false positiveよりunknownを優先する。**
取りこぼした項目は `unresolved[]` へ入れて画面に残す（消さない）。

### 8. ProjectionはCanonicalから導出し、raw utteranceを再解釈しない

`conversationTree` / `meetingDecisionGraph` / Timeline /
`MeetingStateDashboard` / summary・report は、
独立してraw utteranceを再解釈しない。段階的にprojectionへ移行する。

### 9. 移行はBig Bang Rewriteを禁止する

legacy pipelineとSemantic Coreを並列実行してから切り替える。

| Phase | 内容 |
|---|---|
| 0 | 実会話corpus・golden expectations・characterization tests |
| 1 | Semantic Core types + sidecar parser（legacy出力を変えない） |
| 2 | TimelineをSemantic Coreへ移行 |
| 3 | Meeting StateをSemantic Coreへ移行 |
| 4 | Decision Graph / Conversation Treeをprojection化 |
| 5 | Topic / Progress consumersをCanonical Stateへ移行 |
| 6 | 重複heuristics削除 |

各Phase終了時にlegacyとの比較結果を保存する。
切り替えはPhaseごとに独立したフラグで行い、既定値は全て無効とする。
Layer 1のイベントログはlegacy入力の上位集合なので、
ロールバックはprojectionをlegacy実装へ戻すだけでよく、データ移行の巻き戻しは発生しない。

**Phase 6（重複削除）は必ず単独のPRにする。**
他Phaseと混ぜるとrevert単位が壊れ、ロールバック不能になる。

Phase 2は `classifyUtterance` の唯一の利用者であり他に依存者がないため、
最小のリスクでSemantic Coreを本番投入できる場所として先に移す。
Phase 3では `decisionGraph` の形を変えない
（`currentDiscussionState` / `meetingProgress` / `meetingReport` /
`meetingReview` / `meetingSynthesis` / `MeetingStateMap` / `ActionView` /
`DecisionSupportPanel` が依存しているため）。

### 10. realtime処理はルールベースを維持する

parserが生成するassertionの `provenance` は `"rule"` のみとする。
`"model"` は非同期の後処理層専用として型に残すが、Phase 0〜6では生成しない
（AGENTS.md「リアルタイムのセグメント処理はルールベースを維持する」を満たす）。

### 11. STTは型境界のみを共有し、実装は別PRにする

`RawUtterance` / `InputProviderKind` が、STT provider抽象が満たすべき出力契約になる。
本移行に含めるのは型境界のみとし、`SpeechInputProvider` のinterface設計と
認識エンジンの選定ADRは別PRで扱う。
semantic classificationとSTTを同時にdebugしない。

## 既存ADRとの関係

- [ADR 0021](0021-utterance-classification-three-axis-model.md) の §3
  「`utteranceClassification.ts` はMeeting Stateから参照されない／Timelineの表示だけに使う」
  を本ADRが置き換える。禁止の理由は「弱い確定度が確定決定へ混入すること」であり、
  その目的は本ADRでは中央のPromotion Policyと不変条件I1〜I14で担保する。
  3軸モデル自体（§1・§2）と、曖昧な発話を強い分類に倒さない方針（§4の第14項）は維持する。
  provenanceを推測しない方針（§5）は、`epistemic`/`provenance` を
  明示的な軸として持つ形で引き継ぐ。
- [ADR 0018](0018-meeting-state-primary-surface-and-epistemic-boundaries.md) の
  epistemic boundaryは維持し、`CanonicalEntry.basis` として型で強制する。
- [ADR 0019](0019-meeting-state-evidence-unification-and-provenance-honesty.md) の
  provenance honestyを、規則出力への `"human"` 付与の訂正まで拡張する。
- [ADR 0012](0012-incremental-decision-reason-traversal.md) の近接ヒューリスティックは
  `basis: "proximity"` / `epistemic: "inferred"` として明示的に格下げして保持する。

## 帰結

- 同一発話について複数の世界観が成立しなくなる。
- 決定・アクションのfalse positiveを構造的に塞ぐ。取りこぼしは `unresolved[]` に残す。
- 「規則の推定」と「人の確認」をUIが混同できなくなる。
- human correctionが再解析で消えない。
- 移行期間中はlegacyとcoreが併存し、保守コストが一時的に二重化する。
  Phase 6で解消する。
- Phase 3でrecallが一時的に落ちる可能性がある。precisionを優先する方針の帰結であり、
  取りこぼしは `unresolved[]` として画面に残すことで補う。
