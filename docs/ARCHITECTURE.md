# Architecture Overview

## Summary

speak_attension は、**アイデア出し支援を主モード**とするローカル Web アプリです。音声または手入力からキーワードを集め、放射状マップ → マインドマップへと段階的に整理・出力できます。会議ダッシュボード（副モード）も搭載し、ライブ意味階層の表示、ギャップ追跡、セッション後の整理・レポート出力に対応しています。

**技術スタック:**
- Runtime: React 18 + TypeScript + Vite
- Graph visualization: React Flow
- Backend: WebSocket server (Node.js + ws)
- Testing: Vitest
- LLM: LM Studio (ローカル、OpenAI 互換)

---

## Architectural Layers

### 1. **UI Layer**
React components が状態をレンダリングし、ユーザーのコマンドをキャプチャします。

| Component | Role |
|-----------|------|
| `App.tsx` | アプリシェル、モード切替 |
| `IdeaModeView.tsx` | アイデア出しモード全体UI |
| `ideaFlow.tsx` | アイデアセッション → React Flow ノード/エッジ変換 |
| `TopicInspector.tsx` | 会議モード診断パネル |
| `TopicGraph.tsx` / `ConversationNodeEditor.tsx` | ライブ意味階層の表示・編集 |
| `MeetingSummaryGraph.tsx` | 会議整理後のマップ |

**原則:**
- ノードは日本語ラベルを表示（内部ID不可）
- マップはパン・ズーム可能、「全体表示」で全ノード を画面内へ復帰
- 固定座標レイアウト変更時はレイアウトテスト確認

### 2. **Store Layer**
外部状態管理ストア（Zustand-like）が、エンジン層からの出力を管理し、UI に最新状態を提供します。

| Store | Role |
|-------|------|
| `ideaSessionStore.ts` | アイデア出しセッション状態・コマンド |
| `topicEngineStore.ts` | 会議エンジン状態、スナップショット、ログ |
| `useLlmSettings.ts` | LLM 接続設定の localStorage 永続化 |

**特性:**
- 非同期処理（グループ化、LLM 待機）を管理
- React Hook アダプター（`useIdeaSession.ts`、`useTopicEngine.ts`）で UI へ公開
- コマンドベースの更新モデル

### 3. **Engine Layer**
純粋関数のユーティリティが、入力セグメント → グラフ更新へ変換します。

#### アイデア出しエンジン
```
入力（音声／手入力）
  → ideaExtraction（キーワード候補抽出）
  → ideaGrouping（ルールベース / ローカルLLMクラスタリング）
  → ideaLayout（放射状 → マインドマップ座標計算）
  → ideaSession（状態遷移：採用・保留・却下）
```

| Module | Purpose |
|--------|---------|
| `ideaExtraction.ts` | 形態素ベースのキーワード抽出 |
| `ideaGrouping.ts` | ルールベース・LLM 併用クラスタリング |
| `ideaLayout.ts` | 放射状・階層配置の座標計算、重なり回避 |
| `ideaSession.ts` | セッション状態、編集、エクスポート |

#### 会議エンジン
```
発話（音声／手入力／リプレイ）
  → topicExtraction（句・参照解析）
  → topicSelection（トピック作成・マッチングルール）
  → topicCoverage（ギャップ検出・ライフサイクル）
  → conversationTree（ライブ意味階層：話題→課題→原因→アクション/別案）
  → topicEngine（各種スコアリング・ノード状態更新）
```

| Module | Purpose |
|--------|---------|
| `topicExtraction.ts` | 句の抽出、参照解析 |
| `topicSelection.ts` | トピック作成・マッチングルール |
| `topicCoverage.ts` | ギャップ検出・ライフサイクル管理 |
| `conversationTree.ts` | ルールベース意味分類（相槌除外） |
| `conversationTreeLayout.ts` | ツリー座標計算（任意深度、左右バランス） |
| `topicEngine.ts` | セグメント処理オーケストレーター |
| `topicProjection.ts` | 従来分析用 `MeetingGraph` の表示投影 |

#### LLM 統合
```
ルールベース結果
  → llmClient（LM Studio との通信）
  → [ideaGrouping, llmGapReview, llmTopicTitle, llmMeetingSynthesis]
  → LLM 失敗時は fallback 保持
```

| Module | Purpose |
|--------|---------|
| `llmClient.ts` | LM Studio 通信共通部 |
| `llmConnection.ts` | 接続確認・ヘルスチェック |
| `ideaGrouping.ts` | LLM クラスタリング（失敗時ルール) |
| `llmGapReview.ts` | 会議後ギャップレビュー |
| `llmTopicTitle.ts` | トピック名生成補助 |
| `llmMeetingSynthesis.ts` | 終了時マップ要点化 |

**制約:**
- LLM 出力は通常 800 token、会議整理は 1200 token に制限
- ローカル LM Studio のみ使用（クラウド API 不可）
- 全機能に必ずルールベース fallback を用意

---

## Data Flow Diagrams

### アイデア出しモード（メイン フロー）

```
User Input (Voice / Manual)
    ↓
useIdeaSession Hook
    ↓
ideaSessionStore (State Management)
    ↓
[Capture Phase]
  ideaExtraction → ideaSession (collect keywords)
    ↓
    IdeaModeView renders "Radial Map"
    ↓
[Organization Phase: User clicks "Group"]
  ideaGrouping (Rule-based or LLM)
    ↓
    ideaLayout (Hierarchy coords)
    ↓
    IdeaModeView renders "Mind Map"
    ↓
[Selection Phase: User pick adopted/hold/reject]
  ideaSession (state transition)
    ↓
[Export]
  Markdown / JSON (with sources & 3-state)
```

### 会議モード（ライブ フロー）

```
Speech / Manual / Replay Input
    ↓
useTopicEngine Hook
    ↓
topicEngineStore (Mutable runtime)
    ↓
processTopicSegment (Main orchestrator)
    ├─ topicExtraction (Clause + phrases)
    ├─ topicSelection (Topic creation/matching)
    ├─ topicCoverage (Gap detection)
    ├─ topicLifecycle (Closure rules)
    ├─ conversationTree (Live semantic tree)
    └─ MeetingGraph update (Parallel tracking)
    ↓
Real-time Render
    ├─ TopicGraph (React Flow semantic tree)
    ├─ TopicInspector (Diagnostics)
    └─ TranscriptPanel (Transcript log)
    ↓
[Explicit "Organize Meeting"]
  meetingSynthesis (Rule-based summary)
    + llmMeetingSynthesis (LLM refinement if available)
    ↓
    MeetingSummaryGraph renders
```

### 会議整理 → アイデア出しへの引継ぎ

```
MeetingSummaryGraph (Issues / Unresolved selected by user)
    ↓
createIdeaSessionFromMeetingSelection
    ├─ Dedup source utterances
    └─ Attach meeting references
    ↓
ideaSession (Capture phase, with meeting sources)
    ↓
App.tsx switches to Idea Mode
```

---

## Key Modules and Responsibilities

### アイデア出し層
| File | Exports | Tests |
|------|---------|-------|
| `ideaExtraction.ts` | `extractIdeas(utterance)` | `ideaExtraction.test.ts` |
| `ideaGrouping.ts` | `groupIdeasRule()`, `parseGroupingResponse()` | `ideaGrouping.test.ts` |
| `ideaLayout.ts` | `computeRadialLayout()`, `computeHierarchyLayout()` | `ideaLayout.test.ts` |
| `ideaSession.ts` | `IdeaSession`, `createIdea()`, `adoptIdea()`, `exportMarkdown()` | `ideaSession.test.ts` |
| `ideaSessionStore.ts` | `useIdeaSession()` store | (tested via integration) |

### 会議エンジン層
| File | Exports | Tests |
|------|---------|-------|
| `topicExtraction.ts` | `extractClauses()`, `extractPhrases()` | `topicExtraction.test.ts` |
| `topicSelection.ts` | `selectTopics()` | (embedded in engine tests) |
| `topicCoverage.ts` | `detectGaps()`, `deriveLifecycle()` | `topicCoverage.test.ts` |
| `conversationTree.ts` | `buildConversationTree()`, semantic classification | `conversationTree.test.ts` |
| `conversationTreeLayout.ts` | `layoutConversationTree()` | `conversationTreeLayout.test.ts` |
| `topicEngine.ts` | `processTopicSegment()`, main orchestrator | `topicEngine.test.ts` |
| `topicProjection.ts` | `projectMeetingGraph()` | `topicProjection.test.ts` |
| `topicEngineStore.ts` | Mutable store, snapshot, log emission | `topicEngineStore.test.ts` |

### LLM 統合層
| File | Exports | Tests |
|------|---------|-------|
| `llmClient.ts` | `callLmStudio()` | `llmClient.test.ts` |
| `llmConnection.ts` | `checkLlmConnection()` | `llmConnection.test.ts` |
| `ideaGrouping.ts` | LLM clustering prompt + response parse | `ideaGrouping.test.ts` |
| `llmGapReview.ts` | Post-meeting gap review | `llmGapReview.test.ts` |
| `llmTopicTitle.ts` | Topic name generation | `llmTopicTitle.test.ts` |
| `llmMeetingSynthesis.ts` | Synthesis refinement | `llmMeetingSynthesis.test.ts` |

### ユーティリティ
| File | Purpose |
|------|---------|
| `textMetrics.ts` | テキスト寸法測定（レイアウト用） |
| `intentRules.ts` | 発言意図分類 |
| `meetingReport.ts` | レポート生成 |
| `meetingSynthesis.ts` | 会議整理マップ構築 |
| `transcriptImporter.ts` | リプレイ JSON 入力処理 |
| `transcriptReplay.ts` | セッション再生制御 |
| `readerGuide.ts` | UI ガイダンス文生成 |

---

## Design Principles

### 1. **Three-Tier Separation**
- **UI** は状態をレンダリングし、コマンドをストアへ送るだけ
- **Store** は非同期処理と最新スナップショットを管理
- **Engine** は純粋関数、副作用を持たない

### 2. **Pure Function Engine**
- `src/utils` の関数は副作用なし
- ロジック変更時は併置 `*.test.ts` を更新・追加
- 座標計算・状態遷移・抽出ルールは全てテスト対象

### 3. **Rule-First, LLM-Optional**
- ルールベース実装が基本
- LLM は非同期の後処理層のみ使用
- LLM 失敗時は必ずルール結果を保持

### 4. **Layout Testing**
- 固定座標レイアウト（放射状、マインドマップ、会議ツリー）は`ideaLayout.test.ts`、`conversationTreeLayout.test.ts` で保護
- 長短日本語ラベル、複数条件（複数リング、グループ数バリエーション等）を網羅

### 5. **Immutability by Phase**
- アイデア出しは「集約」「整理」「選択」の3フェーズ
- 会議は「ライブ」「整理」の2フェーズ
- フェーズ遷移時のみデータ構造が変わる

### 6. **Japanese-First Labels**
- UI は常に日本語ラベルを表示
- 内部では ID で管理するが、出力・表示は必ず日本語

---

## Deployment & Running

### Development
```sh
npm install
npm run dev
```
- Vite dev server: `http://127.0.0.1:5173/`
- WebSocket server: `ws://127.0.0.1:8787`

### Testing
```sh
npm run check      # TypeScript + Vitest
npm run build      # Production build
```

### Configuration
- LLM 接続先・モデル: Browser localStorage に保存、アイデアモード・会議モード で共有
- 設定 UI: 両モードの「設定」パネル

---

## Known Constraints

1. **Scale**: 放射状レイアウトの衝突回避は、数十キーワードスケールでは十分。数百件規模は空間インデックスが必要
2. **Persistence**: キーワード・トピック・意味階層はセッション在中のみ。リロードで喪失（ルール実装で復帰不可）
3. **STT**: ブラウザーの Web Speech API に依存。ローカル WebSocket ログ中継は任意
4. **No Python DB Auth TTS**: 追加しない（AGENTS.md 参照）

---

## How to Modify Behavior

| Change Target | Start Here |
|---|---|
| アイデア キーワード抽出・グループ化 | `ideaExtraction.ts`, `ideaGrouping.ts`, `ideaSession.ts` |
| アイデア 座標・レイアウト | `ideaLayout.ts` + `ideaLayout.test.ts` |
| 会議 トピック分類・マッチング | `topicExtraction.ts`, `topicSelection.ts` |
| 会議 ギャップ・ライフサイクル | `topicCoverage.ts` |
| 会議 ライブ意味階層 | `conversationTree.ts`, `conversationTreeLayout.ts` |
| UI 説明文 | `TopicInspector.tsx`, `readerGuide.ts` |
| ストア・コマンド フロー | `topicEngineStore.ts`, `ideaSessionStore.ts` |
| LLM 統合 | `llmClient.ts`, `llmConnection.ts` |

---

## References

- [AGENTS.md](../AGENTS.md) — プロジェクト方針、hard constraints
- [STATE.md](STATE.md) — 現在のできることと段階
- [CODE_GUIDE.md](CODE_GUIDE.md) — ファイルマップと read-first チェックリスト
- `docs/adr/` — 設計判断の履歴
