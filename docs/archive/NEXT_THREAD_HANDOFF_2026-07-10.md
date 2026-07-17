# attension_mindmap - Next Thread Handoff (2026-07-10)

Last updated: 2026-07-10

## Summary of Changes in This Session (2026-07-10)

### Rationale
前回(2026-07-09)のセッションでは「抜け漏れ検知」の基盤を実装し、リアルタイムのトピック分析 + 事後レポート層を整備した。しかし、リアルタイム部分のギャップ検知（「浅い議論」「決定不足」など）がまだ精度不十分で、UI上での「提案」として表示すると信頼を損なう恐れがあるという判断に至った。

同時に、バックエンド機能（WebSocketリレー、トピックエンジン、レポート生成、LLM連携基盤）が実際に動作することを確認した。

### Changes Made

#### 1. UI上のギャップ提案表示を全廃止
**目的**: リアルタイムの不確実な「提案」をユーザーに見せない。判定品質が証明されるまで、ギャップは事後レポート層のみで、根拠付きで提示する。

**実装**:
- `src/components/TopicInspector.tsx` 行144-162: 「Current Gaps」セクション削除
  - 従来: 会議進行中に「現在のトピックに対する不足情報」をリアルタイム表示
  - 新: 非表示。ギャップ情報は事後の「抜け漏れレポート」パネルのみで提示

- `src/components/TopicGraph.tsx` 行20-26: ノード上のギャップ関連バッジをフィルタリング
  - 除外する状態: `shallow`, `missing`, `unresolved`
  - 残す状態: `active`, `discussed`, `decided`
  - マインドマップビジュアルから「提案的な」表示が消え、「事実」のみ表示

#### 2. Current Topic パネルの簡潔化（前セッション継続）
- `src/components/TopicInspector.tsx` 行91-94: 「mentions/lifecycle」の重複表示を削除
  - TopicInspectorではシンプルにタイトルのみ表示
  - 詳細情報（メンション数、ライフサイクル）が必要な場合は、マインドマップノード上のツールチップやレポート層で確認可能に

#### 3. リアルタイムガイドテキストの簡潔化（前セッション継続）
- `src/utils/readerGuide.ts` 行32: 「mentions が増えるほど...」という説明を削除
  - 初見ガイドから「提案的な」語呂合わせを除去
  - より客観的で簡潔なメッセージに

### Validation Completed

✓ **Test Suite**: 12 files / 52 tests passed  
✓ **Build**: `tsc --noEmit && vite build` success  
✓ **WebSocket Relay**: 
  - `ws://127.0.0.1:8787` connection confirmed
  - `server:ready` message received
  - Multi-client broadcast relay verified
  
✓ **Topic Engine Pipeline**:
  - Japanese text input → topic extraction (3 topics extracted from 3 test utterances)
  - Coverage detection (dueDate, decision, alternative flags updated correctly)
  - Gap generation backend (8 gaps generated for test data)
  - Meeting report generation (Markdown output with evidence quotes verified)

All code changes compile without errors. No type errors. Production build ready.

---

## プロダクトの方向性（変更なし、前セッション確定内容）

このプロダクトの価値の核は **トピックグラフではなく「抜け漏れ検知」** である。サービス定義は:

> 決まっていないことを、会議が終わる前に教えてくれるツール。

確定した戦略判断:

- 議事録要約(Otter, tl;dv 等)はコモディティ。「まだ決まっていないことをリアルタイムに指摘する」領域で勝負する。
- **リアルタイム化より先に判定品質の証明をやる**。実会議のトランスクリプトを事後投入して「抜け漏れレポート」を出し、指摘の納得率を測る。
- 納得率(助かった率)**7割** がサービスとして成立するかの分水嶺。**適合率優先**。的外れな指摘は一発で信頼を失う。
- 実装順序は **1→3→2**: (1) 事後レポート生成 ✓ → (3) 納得率フィードバック収集 → (2) LLM 判定層活用化
- **LLM はクラウド API を使わず、LM Studio(ローカル、OpenAI 互換 API)限定。** リアルタイムのセグメント処理パイプラインはルールベースのまま維持し、LLM は事後レポート層でのみ使う。
- グラフ UI は削除しないがサブビューへ降格方針。日常利用の主役はチェックリストとアラート。
- 捨てるもの: 代名詞解決の精度追求、グラフレイアウト改良、独自 STT、放射状レイアウト。

この判断の経緯は 2026-07-08〜09 のセッションで議論済み。ユーザー(結仁)の合意済み。

---

## Current State (2026-07-10)

Vite + React + TypeScript のローカルプロトタイプ。以下の機能が動作確認済み:

1. **リアルタイムトピック分析パイプライン**（ルールベース、精度検証中）
   - 日本語音声 / テキスト入力 → トピック自動抽出
   - トピックのカバレッジ追跡（決定・理由・担当・期限・リスク・代替案・異議・依存・次アクション・開かれた質問 の10種類）
   - トピック数・メンション数・ライフサイクル（active/discussed/decided/unresolved）管理
   - WebSocket リレーで複数クライアントの状態同期（オプション）

2. **事後レポート生成層**（2026-07-09実装、本セッションで動作確認）
   - `buildMeetingReport`: 会議終了時点の全トピック・重要メンション → 「抜け漏れレポート」JSON 生成
   - ギャップ再計算: レポート生成時に全トピックの gap を確定（リアルタイムでは gap 生成するが表示しない）
   - Finding ID は決定的 → 人間の評価フィードバックが再生成後も引き継がれる
   - Markdown 出力: 高/中/低優先度別に整理、証拠発言を引用

3. **納得率フィードバック層**（2026-07-09実装）
   - 各 finding に「助かった / ノイズ」評価ボタン
   - localStorage 永続化（キー: `speak_attension.feedback.{meetingId}.{generatedAt}`）
   - 納得率 = helpful ÷ 評価済み、パネル表示
   - 「評価データ」エクスポート: 指摘 + 人間判定 + LLM判定を JSON 束ねる
   - → **このデータセットが将来のルール調整・LLMプロンプト改善のベンチマーク**

4. **LLM 判定層(LM Studio, オプション)**（2026-07-09実装、未検証）
   - OpenAI 互換 API クライアント。デフォルト `http://127.0.0.1:1234/v1`
   - トピック単位でグループ化 → 証拠発言 + ルール検出済み findings をローカルLLMに送信
   - LLM応答: 各 finding に confirm/drop 判定 + 見落とし追加(`llm_added`)
   - **ルール findings を LLM が削除することはない設計**（drop は注記+薄表示のみ）
   - 適合率優先・信頼維持の原則を実装

5. **マインドマップビジュアル**（ReactFlow）
   - 実装は maintained（削除されない）、ただし「提案的な」ギャップバッジは非表示
   - 今後のビジュアル面の改良に向けて基盤は保持

---

## What Changed Since 2026-07-09

| 機能 | 2026-07-09 | 2026-07-10 |
|------|-----------|-----------|
| **リアルタイムギャップ表示** | 「Current Gaps」セクション表示、マインドマップに missing/shallow バッジ表示 | 全廃止。ギャップはバックエンドで検知するが、UI上は表示しない |
| **Current Topic パネル** | 「mentions/lifecycle」を表示 | シンプルにタイトルのみ。詳細情報は削除 |
| **ガイドテキスト** | 「mentions が増えるほど...」と説明 | より客観的・簡潔に |
| **バックエンド動作状態** | コード実装済みだが、実際の動作検証不明 | ✓ 全テスト合格、WebSocket動作確認、トピックエンジン動作確認、レポート生成動作確認 |

**デザイン思想の変化**: 「ユーザーに不確実な提案をリアルタイムで見せる」 → 「判定品質が証明されるまで、ギャップは事後レポート層で根拠付きで提示」

---

## How To Run

```sh
npm install
npm run dev
```

- App: `http://127.0.0.1:5173/`
- WebSocket: `ws://127.0.0.1:8787`
- Ports occupied? `scripts/kill-localhost-port.sh 5173 5174 8787`

### LM Studio(LLM レビューを使う場合、オプション)

1. LM Studio でモデルをロード、ローカルサーバ起動(デフォルト `http://127.0.0.1:1234/v1`)
2. **LM Studio のサーバ設定で CORS を有効化**(ブラウザから直接 fetch するため必須)
3. アプリの「抜け漏れレポート」パネル → 接続確認(モデル id 自動入力)→ レポート生成 → LLMレビュー

---

## Validation (2026-07-10)

- `npm test`: ✓ 12 files / 52 tests passed
- `npm run build`: ✓ 型エラーなし、production build成功
- WebSocket smoke test: ✓ 接続、server:ready受信、ブロードキャスト確認
- Topic engine smoke test: ✓ 3ターン日本語処理、トピック抽出、カバレッジ検出、ギャップ生成、レポート生成全て動作確認

---

## Important Files

**このセッション(2026-07-10)で修正**:
- `src/components/TopicInspector.tsx` - Current Gaps セクション削除、シンプル表示化
- `src/components/TopicGraph.tsx` - ギャップ関連バッジをフィルタリング
- `src/utils/readerGuide.ts` - ガイドテキスト簡潔化

**前セッション(2026-07-09)実装済み、本セッションで動作確認**:
- `src/utils/meetingReport.ts` - レポート構築・Markdown描画
- `src/utils/reportFeedback.ts` - 納得率計算・評価データセット生成
- `src/utils/llmClient.ts` - OpenAI互換ローカルLLMクライアント
- `src/utils/llmGapReview.ts` - LLM判定層(トピックグループ単位)
- `src/components/MeetingReportPanel.tsx` - レポートUI一式
- `src/hooks/topicEngineStore.ts` - segmentArchive追加

**既存の中核機能（変更なし）**:
- `src/utils/topicEngine.ts` - リアルタイムセグメント処理オーケストレータ
- `src/utils/topicExtraction.ts` - トピックフレーズ抽出（ルールベース）
- `src/utils/topicCoverage.ts` - カバレッジ検出・ギャップ生成（ルールベース）
- `src/utils/intentRules.ts` - 発話intent分類（ルールベース）
- `src/utils/topicSelection.ts` - トピック採点・選択
- `src/utils/topicLifecycle.ts` - トピック close処理・重要メンション生成
- `server/index.ts` - WebSocket リレーサーバー（極めてシンプル）

---

## Known Limitations & Design Constraints

### リアルタイムギャップ検知
- ルールベース検出（パターンマッチ）。1〜2発言のトピックには gap が機械的に付きやすい。
- **現在、このギャップはバックエンドで生成・追跡されるが、UI上には表示しない**（精度検証待ち）。
- 事後レポート層でのみ、根拠を示した形で提示。

### LLM判定層
- ローカルLLM(LM Studio)のみ対応。クラウドAPI(OpenAI/Anthropic)は使用していない（方針で明示的に禁止）。
- ユーザー側で LM Studio のインストール・設定が必要。本プロトタイプには含まれない。
- LLM応答が遅く、複数グループの逐次処理のため事後レポート生成は数分要することもある。

### 永続化・認証
- State: メモリのみ。ブラウザリロードで消える。segmentArchive も同様。
- Feedback: localStorage のみ。エクスポート忘れするとブラウザ依存。
- 認証・DB: なし。マルチユーザー対応なし。

### その他
- Web Speech API は Chrome 系推奨。Safari/Firefox での動作は未検証。
- グラフレイアウト改良の予定なし（捨てるもの）。

---

## Recommended Next Work (優先順)

**直近(納得率検証フェーズ)**:

1. **実会議トランスクリプト3〜5本で納得率を測る**（分水嶺の数字）
   - 参加者に「この会議で決まらなかったことは?」を先に書き出させ、ツール出力と突合
   - 「適合率7割」に到達したか検証
   - **このステップがないと、以下のルール調整・LLM投資はムダになる可能性**

2. 手元の録音/字幕データ → リプレイ JSON への変換スクリプト（`transcriptImporter` の受理形式参照）

3. 納得率データを見てから: ノイズ源（特に `shallow`, `missing_decision`）削減
   - ルール閾値調整 or LLM drop 判定をフィルタに昇格させるか判断

4. LLM プロンプト改善（評価データセット + 突合して confirm/drop 精度を測定）

5. 会議終了5分前アラート（リアルタイムのキラー機能）は品質検証後

---

## Design Decisions & Rationale

### なぜリアルタイムギャップ表示を廃止した?

**適合率優先の方針に基づいて**: 「ノイズが1件あると信頼が失われる」という前提のもと、ユーザーに見せる情報は全て「確度の高い」ものだけに限定。リアルタイム提案は精度が不十分なため、バックエンド処理は動かしつつ UI上には表示しない。

将来、納得率7割以上が確認されたら、段階的にリアルタイム表示を復活させることも検討。その際の実装基盤は既に整っている（gap 生成・追跡ロジックは動作中）。

### なぜクラウドLLM APIではなくローカルLLM?

**依存関係を最小化し、試験効率を高める**: 本来はローカル環境で何度も実験したい。ただし納得率検証フェーズでは LLM が必須か未確定なため、LM Studio という「ユーザーが自分で管理できるローカルサーバー」に限定。API キー管理の煩雑さも避ける。

---

## Notes For Next Agent

**重要な制約(2026-07)**:
- クラウド AI API は引き続き禁止。ローカル LLM(LM Studio, OpenAI互換)は事後レポート層に限り許可。
- リアルタイムパイプラインはルールベース維持（LLM投入は納得率7割検証後に再検討）。
- Deepgram, Whisper, Python, DB, auth, TTS, 話者分離は追加しない。
- STT は自作しない。将来は Zoom/Meet の字幕 API から取る構想。

**実装する前に測定すること**:
- 納得率が7割以上か（3〜5本の実会議データで）。これが「サービスとして成立するか」の分水嶺。
- ノイズ源が何か（shallow? missing_decision? 代名詞解決失敗?）。
- LLM判定層が本当に必要か（ルールベース alone で7割に到達できる可能性もある）。

**Finding ID の安定性**:
- Finding の生成 ID は決定的（`${topicId}-${gapType}` など）。変更すると過去の評価フィードバックと突合できなくなる。ID生成規則は慎重に。

**最短デバッグルート**:
```
Transcript Replay パネルに JSON を読ませる
  → レポート生成
  → 納得率を人間が評価
  → 評価データをエクスポート
  → 次の改善サイクル
```

---

## Session Log

**2026-07-09**: 抜け漏れレポート・LLM判定層・納得率フィードバック を実装。
**2026-07-10**: バックエンド動作確認完了。ギャップ提案UI廃止（精度検証待ち）。Current Topic/ガイド簡潔化。
