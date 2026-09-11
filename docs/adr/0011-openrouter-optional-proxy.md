# 0011: OpenRouter はローカルプロキシ経由の任意プロバイダーとして扱う

## 決定

既存の LM Studio を既定値として維持し、LLM を使う非同期後処理では OpenRouter も選択可能にする。OpenRouter の API キーはブラウザーへ渡さず、ローカルの `server/index.ts` が `.env` の `OPENROUTER_API_KEY` を読み、`/api/openrouter/v1` の開発サーバープロキシから転送する。

## 理由

OpenAI 互換のチャット・モデル一覧 API を使えるため、既存の LLM クライアントとルールベース fallback を保ったまま選択肢を追加できる。キーを localStorage や Vite の公開環境変数に置かないことで、ブラウザーのソースやネットワーク要求にキーが含まれない。

## 結果

- LM Studio は従来どおり直接接続できる。
- OpenRouter の API キー未設定・ネットワークエラー・応答エラー時は、各機能の既存ルールベース結果を維持する。
- OpenRouter はローカル開発サーバーと併用する。静的ファイルだけを別のホストへ配置する場合は、同等のサーバー側プロキシが必要である。
