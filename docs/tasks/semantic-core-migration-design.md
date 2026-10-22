# Semantic Core Architecture Migration — 設計（First Deliverable）

Status: draft / 未実装
作成日: 2026-09-28
対象: `src/utils` の意味解釈層、`src/hooks/topicEngineStore.ts`、`design-hinge/`

> **改訂（2026-09-28）**: [ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md)
> により、§3〜§6 の直列パイプライン記述は Fast Path / Refinement Path の
> 二系統へ修正された。§10 に監査結果を追記した。
> 直列パイプラインとして読まないこと。

この文書は移行全体の設計・分析である。恒久的な決定は
[ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md) と
[ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md) に、
Phase ごとの実行手順は [Phase 0](semantic-core-phase0.md) /
[Phase 1](semantic-core-phase1.md) の指示書に記録する。

各 Phase の指示書はこの文書に依存せず単独で実行できる（cold start 用）。
この文書は責務マップ・重複一覧・依存グラフ・リスク分析を参照したいときに読む。
移行完了時に指示書と共に削除する。

---

## 0. 計測した現状（この移行の根拠）

設計を進める前に、同一発話を既存3エンジンへ流して実測した。推測ではない。

### 0.1 同一発話に対する複数の世界観（実測）

| 発話 | Timeline (`utteranceClassification`) | Tree (`conversationTree`) | Decision Graph (`meetingDecisionGraph`) |
|---|---|---|---|
| 個人的に考えているのが1、私は今までどんな情報があって | `option` / `considered` | **`action`** | （なし） |
| スマホで集客しやすいので、対戦ゲーム形式で進めましょう | `reason` / `mentioned` | `statement` | `reason` のみ（**提案が消える**） |
| 対戦ゲーム形式を採用します | **`other` / `none`** | `statement` | `decision` + `action` |
| パフォーマンステストは本日中に完了します | `other` / `none` | `statement` | **`decision` + `action`** |
| レイテンシー削減を優先で進めることにします | `other` / `none` | `statement` | **（なし）** |
| ランキング機能については、保留にしておきましょう | `other` / `none` | `statement` | （なし） |
| 了解です。今日中に確認取ります | **`agenda_item`** | `statement` | （なし） |
| それでいきましょう | `acknowledgement` | `statement` | （なし） |

ユーザーの指摘（Timeline=Proposal / Tree=Action / Meeting State=未確認Action）は
実在する。しかも報告より深刻で、**同じ発話が一方のエンジンで決定、他方で無分類**になる。

### 0.2 Canonical Meeting State への昇格精度（実測）

`demo/*.json`（本リポジトリ自身のサンプル会議）を
`appendMeetingDecisionSegment` → `buildMeetingStateDashboard` へ通した結果:

| corpus | 「今決まっていること」として昇格した項目 | 判定 |
|---|---|---|
| quick-standup | 本日の朝会を始めます。進捗報告をお願いします | **false positive**（会議進行の挨拶） |
| quick-standup | パフォーマンステストは本日中に完了します | **false positive**（進捗報告） |
| product-roadmap | 今日は今四半期のロードマップを確定します | **false positive**（議題提示） |
| product-roadmap | いい質問ですね。そこはまだ検討中です。青チームで検証します | **false positive**（明示的に「検討中」） |
| event-planning | 対戦ゲーム形式を採用します | true positive |
| event-planning | 鈴木さんがプロトタイプを来週金曜日までに作成します | 型誤り（decision と action に二重昇格） |

- **確定決定の precision ≒ 1/6。**
- 同時に、実在する決定（レイテンシー削減を優先 / UI刷新は見送り）は**取りこぼす**。
- `来週金曜日までに` は Timeline 側は期限抽出に成功し、Decision Graph 側は `deadline=-`。
  **同一発話の同一属性で2エンジンが不一致。**

### 0.3 文書化済みの保証が破れている

`docs/STATE.md:29` は
「議題開始の『今日は〜について決めます』は決定済みアクションにしない」と保証する。

実測では `今日は今四半期のロードマップを確定します` が決定済みアクションへ昇格する。
`BOUNDARY_PATTERN` が `について(?:決めます|…)` という**字面**を要求するため、
言い換え（`確定します`）で保証が無効化され、`DECISION_PATTERN` の `します$` に落ちる。

これが局所例外規則の限界である。規則を1本足すたびに、
保証は「その字面でのみ成立する保証」に縮む。**だから classifier への例外追加を止める。**

---

## 1. 現在の semantic responsibility map

### 1.1 実際のパイプライン（コードから再構成）

```
Web Speech ─┐
Manual ─────┼→ topicEngineStore.processSegment(text, source, metadata)
Replay ─────┘        │
                     ├→ processTopicSegment()            [src/utils/topicEngine.ts:156]
                     │   ├→ detectUtteranceIntent()      解釈①  intent 8種
                     │   ├→ extractTopicPhrases()        解釈②  話題語
                     │   ├→ resolveTopicReference()      解釈③  「それ」「この話」
                     │   ├→ chooseSelectedTopic()        解釈④  話題同定
                     │   ├→ detectCoverageUpdates()      解釈⑤  誰/いつ/なぜ の充足
                     │   ├→ relationFromIntent()         解釈⑥  focus 関係
                     │   ├→ createImportantMention()     解釈⑦  重要度
                     │   └→ appendMeetingDecisionSegment() 解釈⑧ 型付きノード8種
                     │                                          ＋ owner/deadline/urgency
                     └→ applyTransition()                [topicEngineStore.ts:183]
                         └→ appendConversationSegment()  解釈⑨  role 6種
                                                          ＋ parent 推定

（UI レンダリング時に、保存済みテキストから再解釈）
ConversationTimeline ──→ classifyUtterance()             解釈⑩  3軸 ＋ owner/deadline
MeetingStateDashboard ─→ buildMeetingStateDashboard()     昇格   decisionGraph から
CurrentDiscussionCard ─→ buildCurrentDiscussionState()    解釈⑪  stage 10種
DecisionSupportPanel ──→ analyzeDecisionMaterials()       解釈⑫  launch/risk/trial/discovery
DesignHingePanel ──────→ ingestUtteranceIntoGraph()       解釈⑬  因果エッジ（独立エンジン）
IdeaModeView ──────────→ extractIdeaKeywords()            解釈⑭  キーワード
```

### 1.2 責務の所在（現状）

| 責務 | 現在の所在 | 問題 |
|---|---|---|
| 正規化された raw utterance | `AnalyzedSegment`（解釈結果と同居） | 一次資料が解釈と不可分 |
| 発話の意味づけ | **⑧⑨⑩ の3箇所が独立に実施** | 世界観が分裂 |
| 関係推定 | ⑧（近接ヒューリスティック）＋⑬ | 近接が confirmed になる |
| 確定状態への昇格 | ⑧が生成時に `state: "decided"` を直接書く | 昇格ポリシーが分散・不可視 |
| human correction | `updateConversationNode`（Tree のみ）/ Timeline は UI state のみ | 再解析で消える・他 projection へ届かない |
| provenance | `createdBy: "human"` を規則出力にも付与 | **規則出力を人間発言と偽装** |

`design-hinge/graph/utteranceIngestion.ts` も規則抽出ノードへ
`origin: "human"`, `provenance: "human"` を付ける。これも同じ偽装である。

### 1.3 昇格が「生成時に確定する」構造上の問題

`appendMeetingDecisionSegment` は `makeNode(..., "decided")` のように
**ノード生成と同時に確定状態を書き込む**。
`buildMeetingStateDashboard` は `state === "decided"` を読むだけなので、
ゲートを掛ける場所が存在しない。これが 0.2 の precision 1/6 の直接原因である。

---

## 2. Duplicated interpretation 一覧

意味概念ごとに、独立した定義が何箇所あるか（実測）。

| 意味概念 | 定義箇所 | 状態 |
|---|---|---|
| 質問 | `meetingDecisionGraph.QUESTION_PATTERN`, `utteranceClassification.QUESTION_PATTERN`, `intentRules` question | 前2つは**バイト単位で同一のコピー** |
| 根拠 | `meetingDecisionGraph.EVIDENCE_PATTERN`, `utteranceClassification.EVIDENCE_PATTERN` | **バイト単位で同一のコピー** |
| アクション | `conversationTree.ACTION_PATTERN`, `utteranceClassification.ACTION_VERB_PATTERN`, `meetingDecisionGraph.ACTION_PATTERN`, `intentRules` todo | 前2つは同一由来だが **`(?<!今)` 修正が片方だけ**／3つ目は同名で別概念（緊急動詞） |
| 課題 | `meetingDecisionGraph.PROBLEM_PATTERN`, `conversationTree.ISSUE_PATTERN`, `utteranceClassification.PROBLEM_PATTERN`, `intentRules` concern | 4系統 |
| 理由・因果 | `meetingDecisionGraph` 内 causal 正規表現, `conversationTree.CAUSE_PATTERN`, `utteranceClassification.REASON_PATTERN`, `design-hinge/edgeCandidateExtraction` | 4系統 |
| 決定 | `meetingDecisionGraph.DECISION_PATTERN`, `utteranceClassification.DECISION_PATTERN`, `intentRules` decision | 3系統・**閾値が異なる**（`します$` を含む/含まない） |
| 提案 | `meetingDecisionGraph.PROPOSAL_PATTERN`, `utteranceClassification.ADVOCATE_PATTERN`, `conversationTree.ALTERNATIVE_PATTERN` | 3系統 |
| 話題境界 | `meetingDecisionGraph.BOUNDARY_PATTERN`, `conversationTree.TOPIC_SWITCH/OPENING/END_PATTERN`, `utteranceClassification.TOPIC_START_PATTERN`, `intentRules` switch_topic | 4系統 |
| 担当・期限 | `meetingDecisionGraph` インライン, `utteranceClassification.extractOwner/extractDeadline` | 2系統・**実測で結果が不一致** |
| フィラー | `topicExtraction.isFillerUtterance` | 唯一の共有（良い前例） |

**`(?<!今)` の片側適用は実害として観測済み**:
`私は今までどんな情報があって…` が Tree で `action` になる（0.1 の1行目）。
同じバグを1箇所で直しても、コピーが残る限り再発する。

`utteranceClassification.AGENDA_ENUMERATION_PATTERN` は
`/今日|今回.{0,10}(?:…)/` と書かれており、選択の結合順により
**`今日` 単独で一致する**。`了解です。今日中に確認取ります` が
`agenda_item` になるのはこのためである（0.1 の7行目）。

---

## 3. Target data model

4層に分離する。上の層は下の層を**書き換えない**。

### 3.1 Layer 1 — Raw Utterance Event Log（唯一の一次資料）

```ts
export type InputProviderKind = "manual" | "replay" | "web_speech" | "external_stt";

export type RawUtterance = {
  id: UtteranceId;
  seq: number;                 // 会議内の単調増加順序
  text: string;                // 原文。正規化・trim 済みテキストは派生値として別に持つ
  createdAt: number;
  speaker: string | null;      // 不明は null。推測しない
  provider: InputProviderKind; // Manual/Replay/Web Speech/将来STT を同じ型へ
  audio?: { startMs?: number; endMs?: number; confidence?: number };
};

export type MeetingEvent =
  | { kind: "utterance_added"; at: number; utterance: RawUtterance }
  | { kind: "human_correction"; at: number; correction: HumanCorrection }
  | { kind: "human_confirmation"; at: number; target: AssertionId; by: "facilitator" }
  | { kind: "human_rejection"; at: number; target: AssertionId; by: "facilitator" };
```

不変条件: イベントログは append-only。再解析はログを消費するだけで書き換えない。

### 3.2 Layer 2 — Semantic Units（0..N per utterance）

一発話一ラベルを禁止する。単位は原文への **span 参照**で表す（原文を複製しない）。

```ts
export type SemanticUnit = {
  id: SemanticUnitId;
  utteranceId: UtteranceId;
  span: { start: number; end: number };   // 原文の文字オフセット
  axes: SemanticAxes;
};
```

6軸を直交概念として保持する。1軸の値が他軸を含意してはならない。

```ts
export type SemanticAxes = {
  scope: Scope;               // 何の層の話か
  role: SemanticRole;         // 何について
  act: DiscourseAct;          // 何をしているか
  commitment: Commitment;     // どこまで確定しているか
  epistemic: EpistemicStatus; // どこまで明示されているか
  provenance: AssertionProvenance; // 誰の判断か
};

export type Scope =
  | "meeting_process"   // 会議の進め方そのもの（議題提示・時間・順序）
  | "subject_matter"    // 議題の中身
  | "artifact_content"  // 成果物の中身（スライド構成・コード・資料）
  | "unknown";

export type SemanticRole =
  | "topic" | "agenda_item" | "context" | "problem" | "reason" | "evidence"
  | "option" | "proposal" | "decision" | "action" | "question"
  | "acknowledgement" | "other";

export type DiscourseAct =
  | "topic_start" | "enumerate" | "report" | "ask" | "suggest" | "advocate"
  | "oppose" | "decide" | "commit" | "defer" | "acknowledge" | "other";

export type Commitment =
  | "none" | "mentioned" | "considered" | "proposed"
  | "accepted" | "decided" | "committed" | "deferred" | "rejected";

export type EpistemicStatus = "explicit" | "inferred" | "ambiguous";
export type AssertionProvenance = "rule" | "model" | "human";
```

`role` と `act` と `commitment` は独立に設定する。
例: `option` を `enumerate` しても commitment は `mentioned` を超えない。
`decision` role は commitment `decided` を**含意しない**（昇格は Layer 4 の責務）。

### 3.3 Layer 3 — Semantic Assertions（machine output は Fact ではない）

同一 unit に対して複数の競合する主張を保持できる。上書きしない。

```ts
export type SemanticAssertion = {
  id: AssertionId;
  unit: SemanticUnit;
  confidence: number;                        // 0..1
  producedBy: { engine: string; version: string };
  createdAt: number;
  supersedes: AssertionId[];                 // 履歴。削除はしない
};

export type RelationAssertion = {
  id: AssertionId;
  from: SemanticUnitId;
  to: SemanticUnitId;
  relation: "supports" | "motivates" | "answers" | "decided_from"
          | "opposes" | "refines" | "unresolved";
  basis: "explicit_marker" | "proximity" | "named_reference" | "human";
  epistemic: EpistemicStatus;
  provenance: AssertionProvenance;
  confidence: number;
  producedBy: { engine: string; version: string };
};
```

不変条件:
- `basis: "proximity"` の関係は `epistemic: "inferred"` 以上に強くできない。
- 関係が確定するのは `basis: "human"` または `basis: "explicit_marker"` のときのみ。
- `relation: "unresolved"` を正式な値として許可する（関係不明を関係なしと混同しない）。

### 3.4 Layer 3.5 — Human Corrections（first-class event）

```ts
export type HumanCorrection = {
  id: string;
  at: number;
  target: { utteranceId: UtteranceId; unitId?: SemanticUnitId };
  // 部分上書き。指定しない軸は machine 推定のまま残す
  axes: Partial<SemanticAxes>;
  // 分割の修正（一発話一ラベル禁止の帰結）
  resegment?: Array<{ span: { start: number; end: number }; axes: Partial<SemanticAxes> }>;
  note: string | null;
};
```

解決規則 `resolveUnit(assertions, corrections)`:
1. `provenance: "human"` の correction が存在する軸は、**常にそれを採用する**。
2. 残りの軸は machine assertion から confidence 最大、同値なら新しい方。
3. 再解析（parser 更新・再生の再実行）は machine assertion のみを置換し、
   correction は保持する。**human correction > machine inference を型で保証する。**

### 3.5 Layer 4 — Canonical Meeting State（昇格後のみ）

```ts
export type PromotionBasis =
  | "human_confirmed"   // 人が確認した
  | "rule_explicit"     // 明示マーカーがある規則判定
  | "rule_inferred";    // 推定のみ（decisions/actions へは入れない）

export type CanonicalEntry<T> = {
  id: string;
  value: T;
  basis: PromotionBasis;
  evidence: { utteranceIds: UtteranceId[]; assertionIds: AssertionId[] };
  promotedBy: { policyVersion: string };
};

export type CanonicalMeetingState = {
  topics:     CanonicalEntry<CanonicalTopic>[];
  context:    CanonicalEntry<CanonicalContext>[];
  problems:   CanonicalEntry<CanonicalProblem>[];
  options:    CanonicalEntry<CanonicalOption>[];
  proposals:  CanonicalEntry<CanonicalProposal>[];
  decisions:  CanonicalEntry<CanonicalDecision>[];   // 厳格ゲート
  actions:    CanonicalEntry<CanonicalAction>[];     // 厳格ゲート
  deferred:   CanonicalEntry<CanonicalDeferred>[];
  questions:  CanonicalEntry<CanonicalQuestion>[];
  unresolved: CanonicalEntry<CanonicalUnresolved>[]; // unknown/ambiguous の正式な行き先
  policyVersion: string;
};
```

`basis` を型に持たせることで、UI は「規則が言っている」と
「人が確認した」を**区別せずに描画できない**（ADR 0018 の要求を型で強制する）。

---

## 4. Promotion invariants

`src/semantic/promotionPolicy.ts` **1箇所のみ**が Canonical State を生成する。
以下を architecture invariant とし、各項目に対応する回帰テストを持つ。

| ID | 不変条件 | 実装述語 |
|---|---|---|
| I1 | option != proposal | `role==="option"` は `proposals[]` に入らない |
| I2 | proposal != decision | `commitment ∈ {mentioned, considered, proposed}` は `decisions[]` に入らない |
| I3 | proposal != action | `role==="proposal"` は `actions[]` に入らない |
| I4 | agenda item != action | `scope==="meeting_process"` は `decisions[]`/`actions[]` に入らない |
| I5 | topic != proposal | `act==="topic_start"` は `proposals[]`/`decisions[]`/`actions[]` に入らない |
| I6 | machine inference != human-confirmed fact | `epistemic!=="explicit"` の昇格は `basis!=="human_confirmed"` |
| I7 | system suggestion != decision | `DecisionMaterial` は `decisions[]` に入らない |
| I8 | ambiguous を強分類しない | `epistemic==="ambiguous"` は `unresolved[]` のみ |
| I9 | deferred != decided | `commitment==="deferred"` は `deferred[]` のみ |
| I10 | report != decision | `act==="report"` は `decisions[]` に入らない |
| I11 | commitment は role から独立 | `role==="decision"` 単独では `decisions[]` へ昇格しない |
| I12 | 近接は因果を確定しない | `basis==="proximity"` の関係は `basis:"rule_inferred"` を超えない |
| I13 | 二重昇格の禁止 | 同一 utterance が `decisions[]` と `actions[]` に同時に入るのは、独立した unit が存在するときのみ |
| I14 | false positive より unknown | いずれの分岐にも合致しなければ `unresolved[]` へ入れる（捨てない） |

I13 は 0.2 で観測した「鈴木さんが…作成します」の
decision/action 二重計上に対応する。

昇格ゲート（`decisions[]` の場合）:

```
昇格する ⟺
     unit.act === "decide"
  ∧  unit.commitment === "decided"
  ∧  unit.scope !== "meeting_process"
  ∧  unit.epistemic === "explicit"
  ∧  ( basis === "human_confirmed" ∨ 明示的決定マーカーが span 内に存在 )
```

`します$` のような語尾だけの一致は「明示的決定マーカー」に**含めない**。
これが 0.2 の4件の false positive を構造的に塞ぐ。

---

## 5. Legacy → target mapping

### 5.1 `conversationTree.ConversationNodeRole`

| legacy | target |
|---|---|
| `topic` | `role: topic`, `act: topic_start` |
| `issue` | `role: problem`, `act: report` |
| `cause` | `role: reason`, `act: report` |
| `action` | **分解**: 担当/期限が明示なら `role: action, act: commit, commitment: committed`／なければ `role: proposal, act: suggest, commitment: proposed` |
| `alternative` | `role: option`, `act: enumerate`, `commitment: mentioned` |
| `statement` | `role` 判定不能 → `other` ＋ `epistemic: ambiguous` |
| （`null` = filler） | `role: acknowledgement`, `act: acknowledge` |

`parentId` 推定 → `RelationAssertion(basis: "proximity", epistemic: "inferred")`。
**現在の暗黙の確定を明示的な推定へ格下げする。**

### 5.2 `meetingDecisionGraph.MeetingNodeType`

| legacy | target |
|---|---|
| `utterance` | Layer 1 の `RawUtterance`（Layer 2 以降には現れない） |
| `evidence` | `role: evidence`, `act: report` |
| `problem` | `role: problem` |
| `reason` | `role: reason` |
| `risk` | `role: problem` ＋ `RelationAssertion(relation: "motivates")`（risk 専用 role は作らない） |
| `question` | `role: question`, `act: ask` |
| `proposal` | `role: proposal`, `commitment: proposed` |
| `decision` | `role: decision`, `act: decide` ＋ **昇格ゲート通過が必要** |
| `action` | `role: action`, `act: commit` ＋ **昇格ゲート通過が必要** |
| `outcome` | `MeetingEvent`（human の記録。解釈ではない） |
| `state: "decided"` | **廃止**。`CanonicalEntry.basis` へ移す |
| `state: "unconfirmed"` | `epistemic: "inferred" \| "ambiguous"` |
| `provenance.createdBy: "human"` | 規則出力は `provenance: "rule"` へ訂正（偽装の修正） |

### 5.3 `utteranceClassification`（3軸）

`role`/`act`/`commitment` はそのまま Layer 2 の同名軸へ移す。
`scope`/`epistemic`/`provenance` を新設し、`oppose`/`defer`/`deferred` を追加する。
`owner`/`deadline` は軸ではなく `CanonicalAction` の属性へ移す（抽出は1箇所に統合）。

### 5.4 `intentRules.UtteranceIntent`

| legacy | target |
|---|---|
| `switch_topic` | `act: topic_start`, `scope: meeting_process` |
| `decision` | `act: decide`（昇格は別判定） |
| `concern` | `role: problem` |
| `todo` | `role: action`, `act: commit` |
| `question` | `act: ask` |
| `agreement` | `act: acknowledge`（`accepted` へ自動昇格しない） |
| `correction` | `MeetingEvent` 側の概念（`human_correction` とは別物として保持） |
| `unknown` | `epistemic: ambiguous` |

`intentRules` は話題選択（`relationFromIntent`）にも使われるため、
Phase 5 まで並存させる。

---

## 6. Migration dependency graph

```
                 ┌─────────────────────────────┐
                 │ Phase 0: corpus + golden    │
                 │ + characterization tests    │
                 └──────────────┬──────────────┘
                                │ 現状の振る舞いを凍結してから触る
                 ┌──────────────▼──────────────┐
                 │ Phase 1: Semantic Core types │
                 │ + sidecar parser（並列実行） │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │ Phase 2: Timeline projection │  ← 依存者ゼロの葉から
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │ Phase 3: Meeting State       │
                 │ （promotionPolicy を経由）   │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │ Phase 4: decisionGraph /     │
                 │ conversationTree を projection化│
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │ Phase 5: topic / progress    │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │ Phase 6: 重複 heuristics 削除 │
                 └─────────────────────────────┘
```

### 6.1 なぜこの順序か（依存の実態）

`decisionGraph` の読み手は以下。Phase 3 で `decisionGraph` の**形を変えない**理由。

| 読み手 | 参照 |
|---|---|
| `meetingStateDashboard.ts` | nodes/edges/state |
| `currentDiscussionState.ts` | node.type ごとの件数で stage 判定 |
| `meetingProgress.ts` | progress ノード生成 |
| `meetingReport.ts` / `meetingReview.ts` / `meetingSynthesis.ts` | レポート |
| `MeetingStateMap.tsx` / `ActionView.tsx` / `DecisionSupportPanel.tsx` | UI |

Timeline（Phase 2）は `classifyUtterance` の唯一の利用者であり、
他に依存者がない。**最小のリスクで Semantic Core を本番投入できる唯一の場所**なので先に移す。

Phase 4 で `decisionGraph` を Canonical State からの投影に置き換えると、
上表の読み手は形が変わらないまま中身が正しくなる。

各 Phase が Fast Path / Refinement Path のどちらを実装するかは
[ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md)
の Phase 表で決定している。Refinement Path の実稼働は Phase 5 まで行わない。

### 6.2 各 Phase の完了条件

各 Phase 終了時に legacy との比較結果を
`src/semantic/__corpus__/characterization/<phase>-diff.json` へ保存する
（`logs/` と `docs/plans/` は git 管理外のため比較結果の置き場にできない）。

- Phase 0: 全 corpus について現状出力のスナップショットが存在し、テストが緑。
- Phase 1: sidecar が全 corpus で例外なく走り、legacy 出力を1つも変えない。
- Phase 2: Timeline の表示が golden と一致。Meeting State に差分ゼロ。
- Phase 3: `decisions[]`/`actions[]` の false positive が 0.2 の実測値から減少し、
  **新規 false positive がゼロ**。
- Phase 4: 上表の読み手すべてで差分が意図した改善のみ。
- Phase 5: topic 選択・progress の差分が説明可能。
- Phase 6: 重複パターン定義が 0 になる（`grep` で検証可能）。

---

## 7. Phase 0 golden corpus 設計

### 7.1 配置

```
src/semantic/__corpus__/
  README.md                  ← 各ケースの意図と「なぜその期待値か」
  cases/*.json               ← 発話列 ＋ 期待値（golden）
  characterization/           ← 現状の legacy 出力スナップショット（正しさは主張しない）
```

corpus は `demo/` ではなく `src/semantic/__corpus__/` に置く。
`demo/` は `.gitignore` 対象のため回帰テストの土台にできない。

### 7.2 ケース形式

```json
{
  "id": "decision-vs-report",
  "intent": "進捗報告を決定として昇格させない",
  "utterances": [
    { "text": "パフォーマンステストは本日中に完了します", "speaker": "開発者A" }
  ],
  "expect": {
    "units": [
      { "scope": "subject_matter", "role": "action", "act": "report",
        "commitment": "mentioned", "epistemic": "inferred" }
    ],
    "canonical": { "decisions": 0, "actions": 0, "unresolved": 1 }
  }
}
```

期待値は **Canonical State の件数**を主で、unit の軸は従で書く。
軸のラベル名は移行中に変わり得るが、「決定に昇格しない」という要求は変わらないため。

### 7.3 必須カバレッジ（ユーザー指定の全項目）

| # | 現象 | 代表発話（実 corpus 由来） | 重要な期待 |
|---|---|---|---|
| 1 | topic start | 今日はイベント形式について決めます | `decisions: 0`（`scope: meeting_process`） |
| 2 | agenda item | 今日整理したいことは3つ、… | `actions: 0` |
| 3 | context | スライドの構成のベースはまず決まっていて… | `decisions: 0`, `problems: 0` |
| 4 | option enumeration | 方法としてA、B、Cがあります | `options: 3 or 1`, `proposals: 0` |
| 5 | personal consideration | 個人的に考えているのが1、私は今までどんな情報が… | `actions: 0`（現状 Tree が `action` にする） |
| 6 | proposal | スマホで集客しやすいので、対戦ゲーム形式で進めましょう | `proposals: 1` ＋ `reason` unit（**2 units**） |
| 7 | support | それでいきましょう / 賛成です | `commitment: accepted`, `decisions: 0` |
| 8 | opposition | それは反対です / それだと厳しいです | `act: oppose`, `commitment: rejected` |
| 9 | decision | 対戦ゲーム形式を採用します | `decisions: 1` |
| 10 | decision（言い換え） | レイテンシー削減を優先で進めることにします | `decisions: 1`（現状は取りこぼし） |
| 11 | action commitment | 鈴木さんがプロトタイプを来週金曜日までに作成します | `actions: 1`, `deadline` 抽出, `decisions: 0`（二重昇格禁止） |
| 12 | deferred idea | ランキング機能については、保留にしておきましょう | `deferred: 1`, `decisions: 0` |
| 13 | acknowledgement | そうですね / ありませんよね | 何も昇格しない |
| 14 | rhetorical question | このステップが完了することは何を意味するか | `questions: 1`, `decisions: 0` |
| 15 | long multi-meaning | 昨日のスプリントタスクは完了しました。ただし、APIレスポンスが予想より遅くて、パフォーマンステストをやり直す必要があります | **3 units**（report / problem / proposal） |
| 16 | reference（それ・これ） | それで進めましょう | 参照解決が不能なら `relation: "unresolved"` |
| 17 | topic change / return | 話を戻すと、Wi-Fi負荷の件ですが | 話題境界。前話題の根拠を引き継がない |
| 18 | 会議進行の挨拶 | 本日の朝会を始めます。進捗報告をお願いします | `decisions: 0`（現状 false positive） |
| 19 | 明示的な検討中 | いい質問ですね。そこはまだ検討中です。青チームで検証します | `decisions: 0`（現状 false positive） |
| 20 | 議題提示の言い換え | 今日は今四半期のロードマップを確定します | `decisions: 0`（STATE.md の保証） |

ケース 15 と 6 は **一発話一ラベル禁止**を直接検証する。
ケース 18–20 は 0.2 で実測した false positive をそのまま固定する。

### 7.4 評価指標

Precision を優先する。`decisions`/`actions` の false positive を**重大 failure** とする。

```
npm run semantic:eval   # corpus 全体を legacy / core 両方で評価し表を出す
```

出力に含める指標:
- `decision_precision`, `action_precision`（**回帰させてはならない**）
- `decision_recall`, `action_recall`（改善目標。precision とトレードオフする場合は precision を採る）
- `unknown_rate`（高いこと自体は失敗ではない）
- `false_positive_cases`（1件でもあればテスト失敗）

### 7.5 characterization test の位置づけ

`characterization/` は**現状の出力をそのまま記録する**（正しさの主張ではない）。
目的は「移行中に意図せず振る舞いが変わっていないこと」の検出。
0.2 で false positive と判定した出力も、Phase 3 で意図的に変えるまでは記録通りに保つ。

---

## 8. Rollback strategy

### 8.1 基本方針

Layer 1 の event log は legacy 入力の**上位集合**である。
そのため「Semantic Core を止める」＝「projection を legacy 実装へ戻す」だけで済み、
データ移行の巻き戻しは発生しない。

### 8.2 切り替え単位

```ts
export type SemanticCoreFlags = {
  core: boolean;          // Layer 1-3 を走らせる（false で完全停止）
  timeline: boolean;      // Phase 2
  meetingState: boolean;  // Phase 3
  decisionGraph: boolean; // Phase 4
  topicProgress: boolean; // Phase 5
};
```

既定値は全 `false`。Phase ごとに1つだけ `true` にする。
各フラグは独立に戻せる（Phase 3 で問題が出ても Phase 2 は維持できる）。

### 8.3 dual-run（並列実行）

Phase 1–5 の間、core と legacy を同時に走らせ、差分を記録する。
UI へ出すのはフラグが指す側のみ。
差分記録は `logs/` へ JSON Lines（既存の `runtimeLog.ts` と同形式）で出す。

コストが問題になる場合は dual-run を replay 実行時のみに限定する。
ライブ会議中の二重実行は必須ではない（差分検出は corpus で足りる）。

### 8.4 各 Phase の rollback 手順

| 事象 | 手順 |
|---|---|
| Phase 2 で Timeline の表示が壊れた | `timeline: false`。`classifyUtterance` は Phase 6 まで削除しないので即復帰 |
| Phase 3 で決定の取りこぼしが増えた | `meetingState: false`。`decisionGraph` は無変更なので他 projection に影響なし |
| Phase 4 で projection が不整合 | `decisionGraph: false`。legacy `appendMeetingDecisionSegment` を再有効化 |
| Phase 6 後に問題発覚 | git revert（この時点で legacy は削除済みのため、Phase 6 は他と別 PR にする） |

**Phase 6（重複削除）は必ず単独の PR にする。** 他 Phase と混ぜると
revert 単位が崩れ、ロールバック不能になる。

---

## 9. Risk analysis

| # | リスク | 影響 | 対策 |
|---|---|---|---|
| R1 | 既存正規表現の振る舞いを暗黙に変える | 既存の保証が静かに壊れる | Phase 0 の characterization test を先に書く。Phase 0 完了までロジックに触らない |
| R2 | 日本語の span 分割が難しい（節境界） | unit 分割が過剰/不足 | 分割不能なら**発話全体を1 unit** にフォールバックする。分割は `splitIntoClauses`（既存）から始める |
| R3 | 6軸を人手で正しく付けられない | corpus の期待値が主観的になる | 期待値の主は **Canonical 件数**。軸は従。軸名変更が corpus を壊さない |
| R4 | `design-hinge` の provenance 偽装（規則出力に `origin: "human"`） | 「人が言った」と「規則が推定した」の区別が壊れる | Phase 1 で `provenance: "rule"` へ訂正。design-hinge は独立エンジンなので Phase 4 以降に扱い、**この移行の必須経路には入れない** |
| R5 | 状態がリロードで消える（DB なし） | 長い実会議を corpus 化できない | corpus は replay JSON ファイル基盤にする。永続化は追加しない（AGENTS.md の制約） |
| R6 | realtime 処理に LLM を入れたくなる | AGENTS.md「リアルタイムのセグメント処理はルールベースを維持する」に違反 | parser は `provenance: "rule"` のみ。`"model"` は非同期後処理専用とし、Phase 1–6 では**生成しない** |
| R7 | ADR 0021 §3 と衝突（Timeline の分類は Meeting State へ流さない） | 既存 ADR の制約違反 | ADR 0022 で §3 を明示的に置き換える。「流さない」→「中央 promotionPolicy だけが流す」 |
| R8 | STT workstream との同時 debug | 原因切り分け不能 | Input Provider は**型境界のみ**を本移行に含める。STT 実装は別 PR（下記 9.1） |
| R9 | dual-run のコスト | ライブ入力が遅延 | 差分検出は corpus で行う。ライブ dual-run は任意 |
| R10 | Phase 3 で recall が落ちる（precision 優先の副作用） | 「決定が出ない」と感じられる | 取りこぼしは `unresolved[]` へ入れて**画面に残す**。消さない。I14 |
| R11 | 移行が途中で止まり legacy と core が恒久的に併存 | 保守コスト二重化 | Phase ごとに独立した価値を持たせる（Phase 2 だけでも Timeline の正確性は向上）。Phase 6 の期限を決める |
| R12 | `AnalyzedSegment.analysis` が広く参照されている | 型変更の波及が大きい | `analysis` は Phase 5 まで**互換のまま維持**し、内部で Canonical から埋める |

### 9.1 STT workstream（前タスク Workstream B）の扱い

本移行の `InputProviderKind` と `RawUtterance` が、
STT provider 抽象が満たすべき**出力契約**そのものになる。

したがって:
- 本移行に含めるのは `RawUtterance` / `InputProviderKind` の**型境界のみ**。
- `SpeechInputProvider` の interface 設計と ADR（Web Speech / server STT / local STT /
  on-device の比較）は**別 PR**。
- 認識エンジンの実装は行わない。

R8 の通り、semantic classification と STT を同時に debug しない。

---

## 次のステップ

1. 本設計のレビュー（特に §4 の invariants と §7.3 の期待値）
2. ADR 0022 を記録
3. Phase 0: corpus ＋ characterization test の実装
4. Phase 1: Semantic Core 型 ＋ sidecar parser（legacy 出力を変えない）

---

# 10. Realtime Architecture Audit（ADR 0023 の根拠）

[ADR 0023](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md) で
Semantic Core を Fast Path / Refinement Path の二系統へ修正した。
その判断根拠となる監査結果を記録する。

計測コマンド: `npm run semantic:bench`（`scripts/benchmarkRealtime.ts`）

## 10.1 現在の1 utterance処理時間

`submitTranscript` 1回の同期時間（ms）。`n` は会議の累積発話数。

|    n | ingest p50 | ingest p95 | ingest max |
|-----:|-----------:|-----------:|-----------:|
|  100 |        0.3 |        0.6 |        0.9 |
|  400 |        0.5 |        0.8 |        8.4 |
|  800 |        0.6 |        1.0 |        2.2 |
| 1600 |        1.0 |        1.8 |        2.2 |
| 3200 |        1.9 |        4.4 |        5.3 |

**Fast semantic budget 150ms に対して消費率3%。** 現状は問題ない。
n=400のmax 8.4msは初回JIT由来で、p95には現れない。

したがってADR 0023は既存の性能問題の修正ではなく、
**Semantic Coreが持ち込みうる退行の予防**である。
この数値がPhase 1以降の回帰基準になる。

## 10.2 各moduleが同期的に行う仕事

発話1件で同期実行されるもの（`processSegment` → `applyTransition`）。

| 順 | module | 仕事 | scope |
|---|---|---|---|
| 1 | `intentRules.detectUtteranceIntent` | intent 8種の判定 | 当該発話のみ |
| 2 | `topicExtraction.extractTopicPhrases` | 話題語候補の抽出 | 当該発話のみ |
| 3 | `topicExtraction.resolveTopicReference` | 「それ」「この話」の解決 | 当該発話＋current topic |
| 4 | `topicSelection.chooseSelectedTopic` | 既存topicとの照合 | **全topic node** |
| 5 | `topicCoverage.detectCoverageUpdates` | 誰/いつ/なぜ の充足判定 | 当該発話のみ |
| 6 | `topicLifecycle.updateCoverage` / `refreshTopicDerivedState` | topic更新 | 対象topicのみ |
| 7 | `topicLifecycle.closeDormantTopics` | 休止topicのclose | **全topic node** |
| 8 | `topicLifecycle.projectState` | React Flow投影の再構築 | graph全体＋直近80発話 |
| 9 | `meetingDecisionGraph.appendMeetingDecisionSegment` | 型付きノード生成・関係付け | **全node（境界走査）** |
| 10 | `topicLifecycle.createImportantMention` | 重要度判定 | 当該発話のみ |
| 11 | `conversationTree.appendConversationSegment` | role判定・親推定 | **全tree node（祖先walk）** |
| 12 | `segmentArchive` への追加 | 配列のspreadコピー | **全archive（O(n)コピー）** |
| 13 | `refreshProgress` → `buildMissingContributions` | 不足点の再評価 | 全gap・全topic・decisionGraph |
| 14 | `refreshProgress` → `buildDiscussionPrompts` | 質問候補の再導出 | **全archive走査** |
| 15 | `runtimeLog.addLog` | ログ追記（payloadに全segment） | O(1) |

描画時（React再レンダリング）に同期実行されるもの:

| module | scope | n=3200実測 |
|---|---|---|
| `meetingStateDashboard.buildMeetingStateDashboard` | 全node＋決定ごとに全edge | 74.8ms（`buildCurrentDiscussionState` 含む） |
| `currentDiscussionState.buildCurrentDiscussionState` | 全node | 0.1ms |
| `ConversationTimeline` の `classifyUtterance` | **全tree nodeを毎回再分類** | 1.5ms |
| `meetingProgress.buildMeetingProgress`（当該マップを開いている場合のみ） | **tree × graph の入れ子** | 336.5ms |

## 10.3 Full-history scanの有無

**ある。** 同期パスに以下が存在する。

| 箇所 | 内容 | 現状の実測影響 |
|---|---|---|
| `appendMeetingDecisionSegment` の境界走査 | `current.nodes.forEach` で全nodeに `BOUNDARY_PATTERN` を適用 | ingestに含まれ、n=3200で4.4ms以内。許容範囲 |
| `buildDiscussionPrompts` | `new Set(segments.map(...))` で全archive | 同上 |
| `segmentArchive` のspreadコピー | 発話ごとに配列全体を複製（合計O(n²)） | 同上 |
| `buildMeetingStateDashboard` | 決定ごとに `selectDecisionParents` が全edgeを走査 | **二次オーダー。n=3200で74.8ms** |
| `buildMeetingProgress` | `tree.nodes` × `graph.nodes.filter(...)` | **二次オーダー。n=1600で84.7ms、n=3200で336.5ms** |

`projectState` は全archiveではなく直近80発話（`state.segments`）のみを見る。
これは正しい設計であり、他モジュールが従うべき前例である。

**結論**: 軽い全履歴走査（ingest内）は現状許容できるが、
描画時の二次オーダー2件は長時間会議で budget を破る。
2時間の会議（5秒に1発話で約1440発話）は実際に到達する範囲である。
`provisionalMeetingState` はこのままn≈5000でbudgetを破る。
ADR 0023 の通り Phase 4 で解消する。

## 10.4 UI renderまでのcritical path

> **訂正（2026-09-28）**: この節の初版は「`flushBuffer` は `speech.stop()` 時に
> しか呼ばれない／遅延は不定」と書いていたが、**誤りだった**。
> `useTopicEngine.ts` に `setInterval(..., SEGMENT_INTERVAL_MS = 5000)` の
> 定期flushが存在し、遅延は**最大5秒で有界**だった（UIの「5秒バッファ」表示は正しい）。
> 結論（音声入力にrealtime性の欠落がある）は変わらないが、大きさが確定した。
> この遅延は [ADR 0024](../adr/0024-realtime-budget-stages-and-speech-boundary-flush.md)
> で修正済み。以下は修正後の記述。

```
Web Speech onresult(isFinal)
  → addTranscriptText()          bufferTextへ連結（解析なし）
  → 終端句読点があれば即flush / なければ無音800msでflush
    （話し続けた場合の上限は5000ms）        ← 修正前は一律5000ms
  → flushSpeechBuffer() → processSegment()
      → processTopicSegment()    上表の1〜10
      → applyTransition()        11〜15
      → emit()                   listener通知
  → useSyncExternalStore が再レンダリング
      → buildMeetingStateDashboard / buildCurrentDiscussionState
      → ConversationTimeline（全件再分類）
```

**修正前のcritical pathで最大の遅延要因は解析ではなく `bufferText` の滞留だった。**
ingestが4.4ms、fast semantic budgetが150msである一方、
音声入力は**発話確定から最大5000ms**（budgetの33倍）segment化されなかった。
manual / replay は `submitTranscript` で直接 `processSegment` へ入るため
遅延を持たず、**入力経路によってrealtime性が異なっていた**。

単純に「final到着ごとに即処理する」修正は採らなかった。
Web Speechの `isFinal` は文末ではなく認識チャンクの区切りであり、
文中で確定するため、即処理すると1発話が複数segmentへ断片化する。
下流の分類器はすべて文単位を前提としているので、
precisionを上げるための移行で逆にprecisionを落とすことになる。

採った方式は**境界シグナルによるflush**である（ADR 0024）。

| 条件 | flushまでの遅延 |
|---|---|
| 終端句読点（`。！？`）で終わるチャンク | 即時 |
| 無音が続いた場合 | 800ms |
| 話し続けている場合（backstop） | 5000ms（変更なし） |

`です` / `ます` などの丁寧形語尾は境界として扱わない。
Web Speechが文中で確定する形なので、これを境界にすると断片化するため。
この判断は `topicEngineStore.test.ts` の
「does not split a polite verb ending into its own segment」で固定している。

## 10.5 Fast Pathへ残す処理

当該発話と局所文脈だけで判定でき、かつ実測で軽いもの。

- 単一発話に対する字句・構造シグナル（intent、話題語、coverage、重要度）
- 6軸のうち明示マーカーで決まる部分（`scope` / `act` / `commitment` の explicit 判定）
- span分割（`segmentUnits`。単一発話内で完結する）
- active topicとの照合（ただしscopeを全topicから **active topic＋直近参照topic** へ縮める）
- provisional Canonical Stateのincremental更新（差分のみ）
- Timeline projection（**新規発話1件のみの分類**に変更する。現在の全件再分類をやめる）

`buildMeetingProgress` は `progressMapRender` として独立したbudget段階になった
（ADR 0024）。分割した各段階がそれぞれのbudget内でも合計が超える場合を
検出するため、`totalVisibleUpdate` も併せて計測する。

## 10.6 Refinement Pathへ移す処理

- pronoun / reference resolution（`resolveTopicReference` の全解決）
- multi-utterance relation resolution（`appendMeetingDecisionSegment` の近接関係付け）
- 全履歴を見る一貫性チェック（`buildDiscussionPrompts`、`buildMissingContributions`）
- ambiguous な option / proposal の切り分け
- `closeDormantTopics`（休止判定は即時性を要しない）
- LLM推論（title refine、gap review、synthesis。すべて既に非同期）
- 二次オーダーの再構築（`buildMeetingProgress`、`buildMeetingStateDashboard` の全再計算）

## 10.7〜10.10（ADR 0023 で決定済み）

重複定義を作らないため、以下は ADR 0023 の該当節を参照する。
この文書に写さない。

| 監査項目 | 決定箇所 |
|---|---|
| 7. Incremental state reducer案 | [ADR 0023 §5](../adr/0023-realtime-first-semantic-core-fast-and-refinement-paths.md) |
| 8. stale async resultを防ぐrevision/version設計 | ADR 0023 §8 |
| 9. human correctionとbackground inferenceの競合解決 | ADR 0023 §9 |
| 10. STT interim/final event contract | ADR 0023 §7 |
