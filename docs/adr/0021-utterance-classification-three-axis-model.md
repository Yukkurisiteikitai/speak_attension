# 0021: 発言分類を意味役割・発話行為・確定度の3軸に分離する

Date: 2026-09-27
Status: accepted

## 背景

Timeline UI（`ConversationTimeline.tsx`）は、`conversationTree.ts` の `classifyConversationRole` が出す単一の役割ラベル（話題/課題/原因/アクション/別案/発言）をそのまま表示していた。実際の会議で使うと、この1ラベルは最低でも3つの異なる問いを混同していることが分かった。

- A. 発言が何について話しているか（例: 話題、課題、選択肢）
- B. 話者がその発言で何をしているか（例: 列挙する、提案する、決定する）
- C. その内容がどこまで確定しているか（例: 言及のみ、検討中、決定済み）

例えば「方法としてA、B、Cがあります」（列挙、未確定）と「私はBが良いと思います」（主張、未採用の提案）と「Bで進めます」（決定、確定）は、旧モデルでは区別できなかった。

## 決定

### 1. 新しい独立モジュール `src/utils/utteranceClassification.ts`

既存の `conversationTree.ts`（TopicGraphや`ConversationNodeEditor`の役割修正が依存する）と、決定グラフ `meetingDecisionGraph.ts`（Meeting State/ダッシュボードが依存する）のどちらも変更しない。代わりに、Timeline専用の新しい純粋関数 `classifyUtterance(text: string): UtteranceClassification` を追加した。

```
UtteranceClassification = {
  semanticRole: SemanticRole,   // 何について
  discourseAct: DiscourseAct,   // 何をしているか
  commitment: Commitment,       // どこまで確定しているか
  owner: string | null,         // semanticRole === "action" のときのみ意味を持つ
  deadline: string | null,
}
```

`semanticRole`（13種）: topic / agenda_item / context / problem / reason / evidence / option / proposal / decision / action / question / acknowledgement / other
`discourseAct`（10種）: topic_start / enumerate / report / ask / suggest / advocate / decide / commit / acknowledge / other
`commitment`（8種）: none / mentioned / considered / proposed / accepted / decided / committed / rejected

いずれも例として与えられた候補をそのまま採用し、これ以上大きなontologyは作らなかった。「決定待ち」に相当する専用commitmentは、既存データから安全に区別する基準が無いため追加していない（`proposed`で代用する）。

### 2. 分類ルール（既存データからのみ導出、優先順位あり）

`meetingDecisionGraph.ts` の質問・根拠・課題パターンと同じ考え方を踏襲しつつ、Timeline用に独立したパターンを新規に持つ（既存モジュールへの影響を避けるため意図的に共有しない）。優先順位は「強く確度の高い構造マーカー」を先に見て、「内容語だけの弱いパターン」を後に見る。

1. 空・フィラー → `acknowledgement`
2. 疑問文（丁寧形の疑問文末、または疑問語＋「か」終わり） → `question`
3. 話題転換（「〜について会議を始める/話す/決める」等） → `topic` / `topic_start`
4. 議題の列挙（「今日整理したいことはN つ」） → `agenda_item` / `enumerate`
5. 背景・前提の明示（「ベースは」「前提として」「現状」等） → `context` / `report`（`問題`などの内容語より先に判定し、誤って`problem`にならないようにする）
6. 明示的な選択の確定（「それでいこう」「〜に決めます」「〜で進めます」。単なる「〜します」文末は含めない） → `decision` / `decide` / `decided`
7. 実行の明示（「対応します」等の実行動詞）で、担当または期限を抽出できる場合のみ → `action` / `commit` / `committed`。担当も期限も抽出できない場合は根拠不足として `proposal` / `advocate` / `proposed` へ弱める。
8. 明示的な主張（「〜が良いと思います」「〜にしたらどうでしょう」「〜を提案します」） → `proposal` / `advocate` / `proposed`
9. 個人的な検討の表明（「個人的に考えているのが」「検討しています」「〜と思っています」） → `option` / `report` / `considered`
10. 選択肢の列挙（「方法として」「候補は」＋複数案） → `option` / `enumerate` / `mentioned`
11. 文中の因果マーカー（「〜ので、〜」等、文頭の「だから」だけでは成立しない） → `reason` / `report` / `mentioned`
12. 課題語（課題・問題・ボトルネック等） → `problem` / `report` / `mentioned`
13. 根拠語（数値・%・エラー率等） → `evidence` / `report` / `mentioned`
14. それでも決まらない場合: 短い発言（12文字以下）は `acknowledgement`、それ以外は `other`。強い意味を無理に割り当てない。

owner/deadline抽出は `meetingDecisionGraph.ts` と同じ発想の正規表現を使うが、実データで見つかった2つの不具合を修正した。「今まで」を期限の「まで」と誤認しないよう除外し、曜日（金曜日等）も期限として認識できるようにした。

### 3. Meeting Stateへの誤昇格を防ぐ

`utteranceClassification.ts` は `meetingDecisionGraph.ts` からも `meetingStateDashboard.ts` からも参照されない。Timelineの表示だけに使う。`option`・`proposal`・`considered` などの弱い確定度は、たとえTimeline上でそう分類されても、`confirmedDecisions`・`nextActions`（既存の決定グラフ由来）には一切影響しない。この分離を壊さないことを本ADRの制約とする。

### 4. UIへの反映

`ConversationTimeline.tsx` の1発言あたりの表示を、単一の役割chipから「主ラベル（semanticRole・アイコン付き）＋副ラベル（discourseAct・commitment）」の組み合わせに変更した（`SemanticBadge`）。色だけに依存せず、アイコン・ラベル・色を併用する。`commitment` が `mentioned`/`considered`/`proposed`/`none` の項目は、`decided`/`committed`/`accepted` と同じ強さの表示にしない。

手動修正のための `TimelineCorrectionMenu` を追加し、自動分類が誤っている場合に `semanticRole` を選び直せるようにした。修正はその場のモデルを再学習させるものではなく、修正済みかどうかと修正後の値をエクスポートJSONに残すことだけを目的とする。

### 5. provenance（発言の由来）について

「参加者自身の発言か、資料の引用か、過去の会議か、システム生成か」を区別する入力データは現状存在しない。文章の内容だけからこれを推測することはしない。将来、入力データにこの情報が明示的に付与された場合に反映できるよう、今回は何も推測せずフィールドを追加しないことにした（既知の未実装）。

## 帰結

- 「候補の列挙」「個人的な検討」「主張」「決定」「実行確約」が別々に見える。誤って強い確定度を持たせるより、`other`/`acknowledgement`に倒すことを優先する。
- 既存の会話マップ（`conversationTree.ts`）・決定グラフ・Meeting Stateの計算には一切変更がない。
- 手動修正はローカルな評価用ログであり、分類ルール自体を変えない。
