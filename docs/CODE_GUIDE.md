# Code Guide

このリポジトリは、アイデア出しを主モード、会議ダッシュボードを副モードとして持つローカル Web アプリです。現在の制約は [AGENTS.md](../AGENTS.md)、実装の現在地は [STATE.md](STATE.md) を確認してください。

## Read This First

| アイデア出しモード（主） | 会議モード（副） |
| --- | --- |
| `src/App.tsx` | `src/App.tsx` |
| `src/hooks/ideaSessionStore.ts` | `src/hooks/useTopicEngine.ts` |
| `src/utils/ideaSession.ts` | `src/hooks/topicEngineStore.ts` |
| `src/utils/ideaExtraction.ts` | `src/utils/topicEngine.ts` |
| `src/utils/ideaGrouping.ts` | `src/utils/topicExtraction.ts` |
| `src/utils/ideaLayout.ts` | `src/utils/topicSelection.ts` |
| `src/components/IdeaModeView.tsx` | `src/utils/topicCoverage.ts` / `src/components/TopicInspector.tsx` |

## Mental Model

アプリは三層に分かれます。

- UI layer: React components render the dashboard and diagnostic panels.
- Store layer: a local external store keeps the latest engine state and user commands.
- Engine layer: pure utilities turn each transcript segment into a graph update.

## Data Flow

### アイデア出しモード

```txt
音声 / 手入力
-> useIdeaSession
-> ideaSessionStore
-> ideaSession + ideaExtraction
-> ideaGrouping（ローカル LLM を使う場合も失敗時はルールベースへ戻る）
-> ideaLayout
-> IdeaModeView
```

会議整理マップで課題・未解決項目を選んだ場合は、`createIdeaSessionFromMeetingSelection` が根拠発言を重複排除し、会議内の出典参照を付けた capture フェーズのセッションを作る。`App.tsx` が保持するアイデアストアへそのセッションを渡してからモードを切り替える。

### 会議モード

```txt
speech / manual text / replay
-> useTopicEngine
-> topicEngineStore
-> processTopicSegment
-> topic extraction + scoring + coverage + lifecycle
-> MeetingGraph update（既存分析用）
-> conversationTree（ライブ意味階層をルールベースで追記）
-> TopicInspector / TopicGraph render（任意深度の右向きツリー）
-> (明示的な「会議を整理」) meetingSynthesis + local LLM refinement
-> MeetingSummaryGraph render
```

## File Map

### `src/App.tsx`

アプリシェルとモード切替。既定でアイデア出しモードを表示し、会議モードの各パネルも組み立てる。

### `src/utils/ideaSession.ts`

アイデア出しセッションの状態遷移、採用・保留・却下、グループ名編集、キーワードと発話の対応、会議整理からの引継ぎ、Markdown/JSON エクスポート。

### `src/utils/ideaExtraction.ts`

発話からアイデアの候補キーワードを抽出する純粋関数。

### `src/utils/ideaGrouping.ts`

キーワードのルールベースクラスタリングと、ローカル LLM 用のグループ化プロンプト・応答パース。

### `src/utils/ideaLayout.ts`

収集時の放射状配置と、グループ化後の「テーマ → グループ → キーワード」という右向き階層配置。ラベルからノード寸法を保守的に見積もり、重なりを避ける。

### `src/hooks/ideaSessionStore.ts` / `src/hooks/useIdeaSession.ts`

アイデア出しの外部ストアと React 用アダプター。非同期のグループ化を管理する。

### `src/components/IdeaModeView.tsx`

アイデアマップ、音声・手入力、グループ化、採用選択、エクスポート UI。

### `src/components/MapViewportControls.tsx`

3種類の React Flow マップで共用するズーム操作と「全体を表示」。`fitKey` が変わる初回・フェーズ切替・再整理時だけ自動で全体表示し、通常のデータ追加ではユーザーの閲覧位置を維持する。

### `src/hooks/useTopicEngine.ts`

Thin React adapter over the store. It exposes the engine state to the UI and keeps the periodic flush timer.

### `src/hooks/topicEngineStore.ts`

Mutable runtime store. It receives commands, owns the current snapshot, and emits logs.

### `src/utils/topicEngine.ts`

Segment processing orchestrator. This is the main place to read when you want to understand what happens after one utterance arrives.

### `src/utils/topicExtraction.ts`

Clause splitting, phrase extraction, and reference resolution.

### `src/utils/topicSelection.ts`

Topic matching and topic creation rules.

### `src/utils/topicCoverage.ts`

Coverage detection, gap generation, lifecycle derivation, and gap sorting.

### `src/utils/conversationTree.ts` / `src/utils/conversationTreeLayout.ts`

リアルタイム発言を話題・課題・原因・アクション・別案・通常発言へ分類し、親を追加時に固定する純粋関数。レイアウトは部分木の高さを先に見積もり、任意深度の右向きツリーを重なりなく配置する。

### `src/utils/topicLifecycle.ts`

Coverage mutation, topic closure, and important mention creation.

### `src/components/TopicInspector.tsx`

Diagnostic side panel. It shows current topic, gaps, coverage, latest analysis, and the developer drawer.

### `src/components/TopicGraph.tsx` / `src/components/ConversationNodeEditor.tsx`

ライブ意味階層のReact Flow表示と、0/1高評価、選択ノードの役割・親修正UI。従来の`MeetingGraph`は表示元ではなく、右レールの分析と会議整理のため並行して保持する。

会議画面の右レールは `App.tsx` で「進行」「分析」に分け、手入力・リプレイ・発話ログは初期状態で閉じた入力ドックにまとめる。非表示パネルもマウントを維持するため、入力途中の内容やレポート状態はタブ切替で失われない。

### `src/lib/download.ts`

ブラウザーでのファイルダウンロード補助。DOM 副作用を持つため `src/utils` ではなく `src/lib` に置く。

### `src/utils/llmClient.ts`

ローカル LLM との通信共通部。`ideaGrouping` と `llmGapReview` から利用する。接続確認は `src/utils/llmConnection.ts` の `checkLlmConnection` を両モードの設定 UI から共用する。

### `src/utils/llmGapReview.ts` / `src/utils/llmTopicTitle.ts` / `src/utils/llmMeetingSynthesis.ts`

会議後レポートのレビュー、トピック名、終了時マップの補助処理。いずれも呼び出し元でルールベースの結果を維持できるようにする。

### `src/utils/meetingSynthesis.ts` / `src/components/MeetingSummaryGraph.tsx`

終了時に発言を固定分類の要点へ整理し、根拠となる原文を開閉できるマップを作る。整理結果はライブの `MeetingGraph` と分離され、タイトル編集も整理結果だけに反映する。

## Tests and replay data

| 変更 | 確認するテスト / データ |
| --- | --- |
| キーワード抽出・グループ化・セッション出力 | `src/utils/ideaExtraction.test.ts`、`ideaGrouping.test.ts`、`ideaSession.test.ts` |
| 放射状・マインドマップの座標 | `src/utils/ideaLayout.test.ts`。長い日本語ラベル、複数リング、未グループ化キーワードを確認する。 |
| 会議のライブ意味階層・Focus・レポート | `conversationTree.test.ts`、`conversationTreeLayout.test.ts`、対応する `src/utils/*.test.ts` と `src/hooks/topicEngineStore.test.ts`。提示Replayの親子関係、相槌除外、高評価、手動修正、任意深度と長短ラベルを確認する。従来分析用の投影は`topicProjection.test.ts`で保護する。 |
| 終了時の整理マップ | `meetingSynthesis.test.ts`、`llmMeetingSynthesis.test.ts`、`topicEngineStore.test.ts`。相槌除外、根拠発言ID、LM Studio失敗時の規則ベース維持を確認する。 |
| リプレイ JSON の入力形式 | `src/utils/transcript-importer.test.ts`。入力形式または検証規則を変えるときに更新する。 |

このリポジトリには独立した fixture ディレクトリはない。トピックや Focus の挙動を変える場合は、該当テスト内の代表発話も仕様として見直す。

## If You Need To Change Behavior

- アイデア出しの状態・出力は `src/utils/ideaSession.ts`、抽出は `src/utils/ideaExtraction.ts`、グループ化は `src/utils/ideaGrouping.ts`、座標は `src/utils/ideaLayout.ts` から始める。
- Topic classification changes usually start in `src/utils/topicExtraction.ts` or `src/utils/topicSelection.ts`.
- Gap / missing-information changes usually start in `src/utils/topicCoverage.ts`.
- UI explanation changes usually start in `src/components/TopicInspector.tsx`.
- Store and command flow changes usually start in `src/hooks/topicEngineStore.ts`.

## Validation

変更後は次を実行する。

```sh
npm run check
npm run build
```
