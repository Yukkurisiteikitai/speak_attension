# Code Guide

このリポジトリは、会議の進行・思考のまとまり・次の検討をマップでつなぐローカル Web アプリです。起動時は会議モードで、補助のアイデア出しも利用できます。現在の制約は [AGENTS.md](../AGENTS.md)、実装の現在地は [STATE.md](STATE.md) を確認してください。

## Read This First

| アイデア出しモード（補助） | 会議モード（主） |
| --- | --- |
| `src/App.tsx` | `src/App.tsx` |
| `src/hooks/ideaSessionStore.ts` | `src/hooks/useTopicEngine.ts` |
| `src/utils/ideaSession.ts` | `src/hooks/topicEngineStore.ts` |
| `src/utils/ideaExtraction.ts` | `src/utils/topicEngine.ts` |
| `src/utils/ideaGrouping.ts` | `src/utils/topicExtraction.ts` |
| `src/utils/ideaLayout.ts` | `src/utils/topicSelection.ts` |
| `src/components/IdeaModeView.tsx` | `src/utils/topicCoverage.ts` / `src/components/TopicInspector.tsx` |
| | `src/utils/meetingStateDashboard.ts` / `src/components/MeetingStateDashboard.tsx`（既定表示） |

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

アプリシェルとモード切替。既定で会議モードの「流れ・次の検討」を表示し、会議モードの各パネルも組み立てる。

### 会議の流れ・次の検討

`src/utils/meetingProgress.ts` は、既存の会話ツリー・決定グラフ・発言アーカイブから思考のつながりを作り、不足点・提案・未確認項目から質問と条件付き予定を導く純粋関数群。明示的な回答を元の問いにつなぎ、その先の検討を作る。`meetingProgressLayout.ts` は全文を残した短縮プレビューの階層配置を行う。

`src/hooks/topicEngineStore.ts` が発言／アクション更新直後の再評価と質問の回答・保留、非同期レビューを管理する。`useTopicEngine.ts` が3秒周期で未レビューの版を確認する。`meetingProgressReview.ts` は入力の組み立てとJSON・出典・条件分岐の検証だけを行い、通信はストアから `requestChat` を呼ぶ。20秒のAbortSignalを渡し、版・設定・リセットをまたぐ応答を捨てる。

`src/components/MeetingProgressMap.tsx` は統合マップ、過去の発言時点の表示、質問選択・回答・次の分岐、Markdown/JSON出力を担当する。UI上の選択と会議状態は分けて保持する。過去表示は発言の接頭列であり、過去のAI提案や手動配置の完全なスナップショットではない。

検証は `meetingProgress.test.ts`、`meetingProgressLayout.test.ts`、`meetingProgressReview.test.ts`、`src/hooks/meetingProgressStore.test.ts`。対応する方針は [ADR 0015](adr/0015-live-meeting-progress-and-conditional-planning.md)。

### `src/utils/ideaSession.ts`

アイデア出しセッションの状態遷移、採用・保留・却下、グループ名編集、キーワードと発話の対応、会議整理からの引継ぎ、表示用の集計セレクター、Markdown/JSON エクスポート。

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

### `src/components/ideaFlow.tsx`

アイデアセッションを React Flow のノード・エッジへ変換する表示アダプターと、ノード表示。収集時の放射状マップと整理時の一方向階層を、UI の状態管理から分離する。

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

### `src/utils/topicProjection.ts`

従来分析用の `MeetingGraph` を表示ノード・エッジへ投影する純粋関数。発言の時系列整理、枝ごとの寸法計算、左右の高さバランス、座標計算、表示要素生成を段階ごとの内部関数に分けている。

### `src/utils/conversationTree.ts` / `src/utils/conversationTreeLayout.ts`

リアルタイム発言を話題・課題・原因・アクション・別案・通常発言へ分類し、親を追加時に固定する純粋関数。レイアウトは部分木の高さを先に見積もり、任意深度の右向きツリーを重なりなく配置する。

### `src/utils/topicLifecycle.ts`

Coverage mutation, topic closure, and important mention creation.

### `src/components/TopicInspector.tsx`

Diagnostic side panel. It shows current topic, gaps, coverage, latest analysis, and the developer drawer.

### `src/components/TopicGraph.tsx` / `src/components/ConversationNodeEditor.tsx`

ライブ意味階層のReact Flow表示と、0/1高評価、選択ノードの役割・親修正UI。従来の`MeetingGraph`は表示元ではなく、右レールの分析と会議整理のため並行して保持する。

会議画面の右レールは `App.tsx` で「進行」「分析」に分け、手入力・リプレイ・発話ログは初期状態で開いた入力ドックにまとめる。非表示パネルもマウントを維持するため、入力途中の内容やレポート状態はタブ切替で失われない。

### `src/lib/download.ts`

ブラウザーでのファイルダウンロード補助。DOM 副作用を持つため `src/utils` ではなく `src/lib` に置く。

### `src/utils/llmClient.ts`

LM Studio との OpenAI 互換通信共通部。`ideaGrouping` と `llmGapReview` から利用する。接続確認は `src/utils/llmConnection.ts` の `checkLlmConnection` を両モードの設定 UI から共用する。通信の成功・失敗は、本文を除いて `src/lib/runtimeLog.ts` 経由でローカルログへ記録する。

`src/hooks/useLlmConnectionCheck.ts` は接続確認中・成功・失敗の表示状態と、未設定モデルの自動入力を両モードで共通管理する。

### `server/index.ts` / `src/lib/runtimeLog.ts`

ローカルサーバーはブラウザーからの構造化ログを `/api/logs` で受け、`logs/runtime-YYYY-MM-DD.jsonl` へ追記する。`/api/discord/report` は `.env` の `DISCORD_WEBHOOK_URL` だけを使ってレポートを送る。URLやLLM入力本文はログへ保存しない。

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

### 会議の状況（中央ダッシュボード、既定表示）

`src/utils/meetingStateDashboard.ts` の `buildMeetingStateDashboard` は、決定グラフと判断材料（`decisionSupport.ts`）を読み替えるだけの純粋関数で、新しい確定状態は作らない。確定した決定（`type: decision` かつ `state: decided` のみ）、構造上の不足（アクションの担当・期限欠落をルールで検出）、未確認・未解決（未回答の質問・未採用の提案・`state: unconfirmed`）、AIの確認候補（判断材料の `status: open/recheck`）、人間が確認した項目（`status: checked/decided/accepted`）、次にやること、NOW（今この瞬間に見るべき1件、ルールによる補助表示であり確定判断ではない）を分けて返す。`src/components/MeetingStateDashboard.tsx` はこの view model を表示するだけで分類は行わない。`meetingStateDashboard.test.ts` が各分類の境界（proposal が confirmedDecisions に混入しない、AI提案が確定・構造上の不足に昇格しない等）を検証する。方針は [ADR 0018](adr/0018-meeting-state-primary-surface-and-epistemic-boundaries.md)。

### 現在状態から出典への探索

`src/components/MeetingStateMap.tsx` は会議中央の現在状態一覧、段階的な根拠探索、全文表示、ダウンロードを担当する。ダッシュボードの各項目の「根拠を見る」からもこのマップへ遷移する。`src/utils/meetingDecisionLayout.ts` は選択ノードと直接の参照先の配置を行い、`meetingDecisionLayout.test.ts` が長短ラベルのプレビュー寸法と衝突を確認する。`src/utils/meetingState.ts` は未決定の選択、共通日本語ラベル、出典を含むスナップショットとMarkdown生成を共用する。`meetingState.test.ts` と `meetingDecisionGraph.test.ts` が現在状態・手動更新履歴・出典参照を検証する。会議状態は引き続き `topicEngineStore` と純粋な決定エンジンが所有し、ローカルサーバーへ状態APIは追加しない。

### 明示的な確認・改善

`src/utils/meetingReview.ts` が残り時間と質問種別から時間内の質問・持ち越しを選別する。`topicEngineStore` が議論／確認・改善／最終確認／確認終了と確認結果を保持し、議論中のAI質問レビューを抑止する。`MeetingReviewPanel.tsx` は残り時間の設定、振り返り、最終確認の記録を担当し、`MeetingProgressMap.tsx` は確認中だけ質問を提示する。`meetingReview.test.ts` と `meetingProgressStore.test.ts` で時間配分、明示的開始、古いAI応答の破棄、最終確認の再実施を検証する。
