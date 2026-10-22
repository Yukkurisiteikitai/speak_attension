# 技術管理レポート

最終更新: 2026-09-09

## このアプリがすること

ローカルで動く React / TypeScript の会議・アイデア出し支援アプリです。音声または手入力を受け、リアルタイム処理ではルールベースでキーワードや会議構造を作ります。LLM は後処理の補助だけに使い、利用できない場合にも機能は継続します。

## 構成と責務

| 領域 | 主な場所 | 管理時の要点 |
| --- | --- | --- |
| アプリ画面とモード切替 | `src/App.tsx` | アイデア出しが主モード、会議ダッシュボードが副モード。 |
| アイデア出しの状態・変換 | `src/hooks/ideaSessionStore.ts`, `src/utils/ideaSession.ts` | 状態遷移、採否、Markdown/JSON出力をここで管理する。 |
| 会議の状態・リアルタイム処理 | `src/hooks/topicEngineStore.ts`, `src/utils/topicEngine.ts` | 発話1件ごとの処理はルールベースで完結させる。 |
| LLM通信 | `src/utils/llmClient.ts`, `src/utils/llmConnection.ts` | LM Studio (`http://127.0.0.1:1234/v1`) だけを使う。失敗は呼び出し元でルールベース結果を保持する。 |
| ローカルHTTP/WebSocket | `server/index.ts` | WebSocket中継、ログ保存、Discord送信の秘密情報管理を担う。 |
| ブラウザの運用ログ | `src/lib/runtimeLog.ts` | ブラウザはファイルを直接書けないため `/api/logs` へ送る。 |

より詳細なコード案内は [CODE_GUIDE.md](CODE_GUIDE.md) を正とします。

## 実行時のデータフロー

```text
音声 / 手入力
  -> React hook / store
  -> 純粋関数のルールベースエンジン
  -> 画面・Markdown・JSON

明示した LLM 後処理
  -> LM Studio OpenAI互換API
  -> 成功: 補助結果を反映
  -> 失敗: 既存のルールベース結果を使い続ける

LLM通信の状態
  -> src/lib/runtimeLog.ts
  -> POST /api/logs
  -> logs/runtime-YYYY-MM-DD.jsonl
```

## 開発・確認手順

```sh
npm run dev
npm run check
npm run build
```

`npm run check` は型チェックとテスト、`npm run build` は本番ビルド確認です。UIまたはビルド設定を変更した場合は両方実行します。

エンジン層のロジックを変える場合、同じ `src/utils/` にある `*.test.ts` を必ず更新します。固定座標レイアウトを変える場合は、長いラベルと短いラベルの両方をテストします。

## LLM通信の障害切り分け

1. アプリの「接続確認」を実行する。
2. LM Studioでサーバーが起動していること、対象モデルがロード済みであることを確認する。
3. 接続先が `http://127.0.0.1:1234/v1` であることを確認する。
4. `logs/runtime-YYYY-MM-DD.jsonl` の `llm.models.failed` と `llm.chat.failed` を確認する。
5. HTTPエラー、モデル未ロード、出力上限、JSON形式不正の順に原因を絞る。

ログは状態・エラー理由だけを記録します。発話本文、LLMプロンプト、Discord Webhook URLは記録しません。

## Discordレポート運用

`.env` に `DISCORD_WEBHOOK_URL` を設定します。この値はクライアントへ渡さず、`server/index.ts` または送信スクリプトだけが読みます。

- 会議の内容: 会議画面でレポート生成後、「Discordへ送信」を選ぶ。
- 技術管理レポート: `npm run report:discord` を実行する。

Discordは外部通知専用です。LLM通信にクラウドAIを追加してはいけません。

## 変更時の判断基準

- リアルタイム処理にLLMを組み込まない。
- 新しいLLM機能には必ずルールベースのfallbackを用意する。
- DB、認証、独自STT、TTS、話者分離は追加しない。
- 実装状態が変われば `docs/STATE.md` を更新する。
- 長期的な設計判断は新しいADRとして追加し、既存ADRは変更しない。
