# 運用・通信実装レポート

## 目的

LM Studio との通信失敗を追跡できるようにし、ブラウザーとローカルサーバーの稼働ログをファイルへ保存する。会議レポートと実装レポートは、設定済みの Discord Webhook に共有できる。

## 仕組み

- LLM のモデル取得・チャット完了・失敗を、入力本文を含めず構造化ログとして記録する。
- ブラウザーのログは `POST /api/logs` を経由し、ローカルサーバーが `logs/runtime-YYYY-MM-DD.jsonl` へ追記する。
- サーバーの起動と Discord 送信成功・失敗も同じ形式で記録する。
- 会議画面で生成した「抜け漏れレポート」は「Discordへ送信」から送れる。Webhook URL は `.env` の `DISCORD_WEBHOOK_URL` だけで保持する。

## 調査時に読む情報

1. `logs/runtime-YYYY-MM-DD.jsonl` の `llm.models.failed` または `llm.chat.failed` を確認する。
2. `baseUrl` が `http://127.0.0.1:1234/v1`、LM Studio でモデルがロード済み、かつ CORS が許可されていることを確認する。
3. `Discord送信失敗` の場合は、Webhook URL の有効性と Discord の HTTP ステータスを確認する。Webhook URL 自体はログに出ない。

## 運用上の注意

ログは要約された通信状態だけを保存し、発話本文・LLMプロンプト・Webhook URL は保存しない。LLMが失敗しても、既存のルールベース処理を継続する。
