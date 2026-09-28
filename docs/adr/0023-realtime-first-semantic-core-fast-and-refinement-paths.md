# 0023: Semantic Coreをrealtime-firstの二系統（Fast Path / Refinement Path）にする

Date: 2026-09-28
Status: accepted

## 背景

[ADR 0022](0022-semantic-core-and-central-promotion-policy.md) は意味解釈の
中央集約を決めたが、パイプラインを

```
Raw → Semantic Unit → Context/Relation Resolver → Assertions → Promotion → Canonical → Projections
```

と直列で記述した。この記述は、発言確定後に複数段の解析が完了するまで
UIが更新されないarchitectureとして実装され得る。

この製品の原点は「会議中にリアルタイムで状態・判断材料を扱えること」である。
精度のためにリアルタイム性を失うのは改善ではなく退行である。

### 実測した現状（`npm run semantic:bench`）

修正の前に、legacy pipelineの実測を取った。単位はms、`ingest` は
`submitTranscript` 1回の同期時間、`n` は会議の累積発話数。

|    n | ingest p50 | ingest p95 | timeline | meetingState | progressMap |
|-----:|-----------:|-----------:|---------:|-------------:|------------:|
|  100 |        0.3 |        0.6 |      0.2 |          0.2 |         0.6 |
|  400 |        0.5 |        0.8 |      0.2 |          1.2 |         4.8 |
|  800 |        0.6 |        1.0 |      0.4 |          4.9 |        22.4 |
| 1600 |        1.0 |        1.8 |      0.8 |         20.8 |        84.7 |
| 3200 |        1.9 |        4.4 |      1.5 |         74.8 |       336.5 |

budget照合（n=3200時点）:

| stage | budget | 実測 | 消費率 |
|---|---|---|---|
| timelineRender | 50ms | 5.9ms | 12% |
| fastSemantic | 150ms | 4.4ms | 3% |
| provisionalMeetingState | 200ms | 79.2ms | 40% |

分かったことは2つある。

1. **legacy pipelineは現時点で全budgetを満たしている。**
   したがって本ADRの目的は既存の性能問題の修正ではなく、
   **Semantic Coreが持ち込みうる退行の予防**である。
2. **二次オーダーの時間爆弾が2つある。**
   `meetingState` と `progressMap` は発話数に対して概ね二次で増える
   （倍長で約4倍）。`progressMap` は `buildMeetingProgress` が
   `tree.nodes` × `graph.nodes.filter(...)` の入れ子であるため、
   n=1600で84.7ms、n=3200で336.5msに達する。
   2時間の会議（5秒に1発話で約1440発話）は実際に到達する範囲である。
   `provisionalMeetingState` はこのままn≈5000でbudgetを破る。

`progressMap` は「流れ・次の検討」を開いているときだけ描画されるため
budget対象の段階には含めないが、計測した中で最も増加が速い。

## 決定

### 1. 二系統に分ける

直列の単一パイプラインを禁止する。

```
final utterance
  ├─→ Fast Path ──────→ Timeline即時更新 / provisional Canonical State更新
  └─→ Refinement Path（非同期）──→ 追加Assertion / Revision Event
```

Refinement PathはFast Pathを待たせない。Fast PathはRefinement Pathを待たない。

### 2. Fast Pathの制約

発言確定（final）直後に実行する。使えるものを限定する。

- lightweight rules（単一発話に対する字句・構造シグナル）
- current local context（後述のprocessing scope）
- explicit lexical/structural signals

禁止する:

- **会議全履歴の再解析**
- **LLM responseの待機**（同期的なLLM呼び出し自体を行わない）
- **Canonical Stateのゼロからの再構築**

Fast PathはUIをblockしない短い処理に限定する。

### 3. Refinement Pathの担当範囲

Fast Pathと非同期で走る。

- pronoun / reference resolution（「それ」「これ」）
- multi-utterance relation resolution
- long-context interpretation
- ambiguous option / proposal distinctions
- optional local LLM inference（LM Studioのみ。[ADR 0003](0003-local-llm-only-lm-studio.md)）
- global consistency checks / background reconciliation

結果は新しいAssertionまたはRevision Eventとしてstateへ入れる。
既存のAssertionを破壊的に書き換えない（ADR 0022 §4）。

全履歴を見る処理はbackground reconciliationとしてのみ許可する。

### 4. Processing scope（incremental processing）

新しいutteranceごとに会議全体を再解析してはならない。
Fast Pathのscopeは原則として次に限定する。

- new utterance
- active topic
- recently referenced entities
- small rolling context（直近の一定件数または一定時間。既定値は実装時に決め、定数として1箇所に置く）

### 5. Incremental Canonical State

Canonical Meeting Stateを毎回ゼロから再構築しない。
Event / Assertionを受け取るincremental reducerとして設計する。

```ts
export type ReduceResult = {
  state: CanonicalMeetingState;
  // 変わったentityのみ。projectionはこれを見て部分更新する
  changedEntityIds: string[];
};

export type CanonicalReducer = (state: CanonicalMeetingState, event: SemanticEvent) => ReduceResult;
```

stateは `byUtteranceId` / `byTopicId` などの索引を保持し、
昇格判定は影響を受けたentityだけ再評価する。

これはADR 0022 §6の「昇格は単一のPromotion Policyだけが行う」と両立する。
Promotion Policyの適用範囲が全体から差分に変わるだけであり、
**昇格の判断地点が増えてはならない。**

### 6. Provisional / Explicit / Human-confirmed

Fast Pathで曖昧なものをconfirmed stateへ昇格させない。
[ADR 0022](0022-semantic-core-and-central-promotion-policy.md) §6 の
`PromotionBasis` を以下に拡張する。

```ts
export type PromotionBasis =
  | "provisional"      // Fast Pathの暫定。後から修正され得る
  | "rule_explicit"    // 明示マーカーのある規則判定
  | "human_confirmed"; // 人が確認した
```

ADR 0022 の `rule_inferred` は `provisional` に統合する
（「推定のみ」と「暫定」は運用上同じ扱いになるため、区別を増やさない）。

- machine inferenceは後から修正可能とする。
- **human-confirmed stateはbackground refinementで上書きしない。**
- `provisional` は `decisions[]` / `actions[]` へ入れない
  （ADR 0022 の不変条件 I6 をそのまま継承する）。

### 7. STT boundary

```
interim transcript → transcript preview のみ
final transcript   → Fast Semantic Path
```

interim transcriptは原則としてSemantic Stateへcommitしない。
interim semantic previewを出すことは許可するが、
**canonical stateへ昇格させない。**

イベント契約:

```ts
export type TranscriptEvent =
  | { kind: "interim"; provider: InputProviderKind; providerSeq: number; text: string; at: number }
  | { kind: "final";   provider: InputProviderKind; providerSeq: number; text: string; at: number; confidence?: number };
```

- `interim` は同一 `providerSeq` のpreviewを置き換えるだけで、
  `RawUtterance` を作らず、イベントログにも入らない。
- `final` は `RawUtterance` をちょうど1件作り、イベントログへ入り、Fast Pathを起動する。
- 同一 `providerSeq` の `final` は、それまでの `interim` をすべて置き換える。
- `final` の後に届いた同一 `providerSeq` の `interim` は破棄する。
- 同一 `providerSeq` に対する `final` の二重適用は冪等とする。

### 8. Stale async resultの防止（revision / version）

Canonical Stateは単調増加の `revision` を持つ。
entityごとにも `entityRevision` を持つ。

Refinementジョブは以下を携える。

```ts
export type RefinementJob = {
  id: string;
  basedOnRevision: number;
  // 読んだentityとその時点のrevision
  readEntities: Array<{ entityId: string; entityRevision: number }>;
};
```

適用規則:

1. `readEntities` のいずれかの `entityRevision` が現在値と異なる場合、
   その結果は**破棄する**（必要なら再投入する）。
2. human correctionが介在したentityには、いかなるrefinement結果も適用しない。
3. 破棄したこと自体はログに残す（黙って捨てない）。

これによりRefinement結果の到着順序に依存しない。

### 9. Human correctionとbackground inferenceの競合解決

優先順位は [ADR 0022](0022-semantic-core-and-central-promotion-policy.md) §5 の
`human correction > machine inference` を維持する。

- `human_correction` は (unitId, axis) 単位で権威を持つ。
- refinement assertionは**常に保存する**（ログからは消さない）が、
  human correctionがある軸については `resolveUnit` が machine値を無視する。
- refinementがhuman correctionと矛盾した場合、`conflict` として記録し、
  UIで「参加者の修正と自動解析が異なります」と提示できるようにする。
  **自動適用はしない。**
- human-confirmedなCanonicalエントリはrefinementで変更できない。
  refinementは `unresolved[]` への追記のみ許可する。

### 10. Performance budgets

initial engineering targetとする。**保証値ではない。**

| stage | budget |
|---|---|
| final utterance → Timeline render | 50ms |
| Fast semantic processing | 150ms |
| provisional Meeting State update | 200ms |
| deep refinement | realtime UIをblockしないこと（時間上限は設けない） |

閾値は `src/semantic/realtimeBudget.ts` に単一定義として置く。
計測は `npm run semantic:bench`（`scripts/benchmarkRealtime.ts`）で行い、
**benchmark / reportとして扱う。**
CI環境のばらつきがあるため、hard flaky timing testにはしない
（benchmarkは常にexit 0。budget判定は表として出力する）。

各Phaseの前後でbenchmarkを実行し、同じ発話数でのbudget消費率を悪化させない。

### 11. Architecture invariant

- **精度向上のためにリアルタイム性を犠牲にしない。**
- **リアルタイム性のために推論をconfirmed factへ昇格させない。**

すなわち `Fast + provisional` と `Slow + refined` を共存させる。

どちらか一方を選ぶ設計（全部同期で正確に / 全部即時で不正確に）を禁止する。

## ADR 0022 との関係

ADR 0022 は有効なまま、以下を本ADRが修正する。

| ADR 0022 | 修正内容 |
|---|---|
| §1 の直列パイプライン図 | Fast Path / Refinement Pathの二系統に置き換える |
| §6 `PromotionBasis` の `rule_inferred` | `provisional` に統合する |
| §9 のPhase定義 | 各Phaseに「Fast/Refinementのどちらを実装するか」を明示する（後述） |
| §10 realtime処理のルールベース維持 | 維持。LLMはRefinement Path専用であることを明確化する |
| §11 STT境界 | interim/finalのイベント契約を追加する |

変更しないもの: 4層モデル、6軸、Assertion、human correction優先、
不変条件 I1〜I14、昇格の単一地点、unknown優先、Big Bang Rewrite禁止。

### Phaseへの反映

| Phase | Fast / Refinement |
|---|---|
| 1 | Fast Pathのみ（sidecar）。Refinement Pathは型と空の実行基盤だけ用意する |
| 2 | Timelineを Fast Path の出力へ接続する |
| 3 | provisional Canonical State を incremental reducer で更新する |
| 4 | projection化。`progressMap` の二次オーダーをここで解消する |
| 5 | Refinement Path を実際に稼働させる（reference解決・relation解決） |
| 6 | 重複heuristics削除 |

Refinement Pathの実稼働をPhase 5まで遅らせるのは、
Fast Pathが安定する前に非同期の競合解決をdebugしないためである
（ADR 0022 §11 と同じ理由）。

## 帰結

- 発言後の待ち時間が解析の深さに依存しなくなる。
- 精度の高い解釈は遅れて届くが、届くまでの間も画面は更新される。
- 同じ項目が時間をおいて `provisional` → `rule_explicit` / `human_confirmed` と
  変化しうる。UIはこの変化を「訂正」として提示する必要がある。
- `meetingState` と `progressMap` の二次オーダーは既存の問題として残る。
  Phase 4で解消する。それまでは長時間会議でbudgetを超え得ることを既知の未解決課題とする。
- Refinement結果の破棄（revision不一致）が起こり得る。
  取りこぼしを防ぐため、破棄はログに残し、background reconciliationで再評価する。
