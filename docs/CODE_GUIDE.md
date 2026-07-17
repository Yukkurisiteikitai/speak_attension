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

### 会議モード

```txt
speech / manual text / replay
-> useTopicEngine
-> topicEngineStore
-> processTopicSegment
-> topic extraction + scoring + coverage + lifecycle
-> MeetingGraph update
-> TopicInspector / TopicGraph render
```

## File Map

### `src/App.tsx`

アプリシェルとモード切替。既定でアイデア出しモードを表示し、会議モードの各パネルも組み立てる。

### `src/utils/ideaSession.ts`

アイデア出しセッションの状態遷移、キーワードと発話の対応、Markdown/JSON エクスポート。

### `src/utils/ideaExtraction.ts`

発話からアイデアの候補キーワードを抽出する純粋関数。

### `src/utils/ideaGrouping.ts`

キーワードのルールベースクラスタリングと、ローカル LLM 用のグループ化プロンプト・応答パース。

### `src/utils/ideaLayout.ts`

収集時の放射状配置と、グループ化後のマインドマップ配置。ラベルからノード寸法を保守的に見積もり、重なりを避ける。

### `src/hooks/ideaSessionStore.ts` / `src/hooks/useIdeaSession.ts`

アイデア出しの外部ストアと React 用アダプター。非同期のグループ化を管理する。

### `src/components/IdeaModeView.tsx`

アイデアマップ、音声・手入力、グループ化、採用選択、エクスポート UI。

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

### `src/utils/topicLifecycle.ts`

Coverage mutation, topic closure, and important mention creation.

### `src/components/TopicInspector.tsx`

Diagnostic side panel. It shows current topic, gaps, coverage, latest analysis, and the developer drawer.

### `src/utils/llmClient.ts`

ローカル LLM との通信共通部。`ideaGrouping` と `llmGapReview` から利用する。

### `src/utils/llmGapReview.ts` / `src/utils/llmTopicTitle.ts`

会議後レポートのレビューとトピック名の補助処理。どちらも呼び出し元でルールベースの結果を維持できるようにする。

## Tests and replay data

| 変更 | 確認するテスト / データ |
| --- | --- |
| キーワード抽出・グループ化・セッション出力 | `src/utils/ideaExtraction.test.ts`、`ideaGrouping.test.ts`、`ideaSession.test.ts` |
| 放射状・マインドマップの座標 | `src/utils/ideaLayout.test.ts`。長い日本語ラベル、複数リング、未グループ化キーワードを確認する。 |
| 会議のトピック・Focus・レポート | 対応する `src/utils/*.test.ts` と `src/hooks/topicEngineStore.test.ts`。リプレイ用の代表発話は各テストに併置されている。 |
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
