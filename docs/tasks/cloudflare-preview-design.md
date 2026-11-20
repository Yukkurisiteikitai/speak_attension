# Cloudflare Workers プレビュー環境の設計案

Issue #30に対応するM1用の隔離プレビュー案。**この文書は設計案で、Cloudflare設定・GitHub Secrets・本番設定を変更しない。**

## 現状

- `.github/workflows/cloudflare-pages.yml` は `main` へのpushまたは手動実行で `pnpm run build` の後に `wrangler deploy` を実行する。
- `wrangler.toml` のWorker名は `speak-attension`。現行ワークフローにpreview環境はなく、PRごとのURLもない。
- このため、本番反映前に公開URLだけで確認する経路は未整備。
- 現在のアプリは会議記録を端末内IndexedDBに保存し、共有DBや認証は使わない。previewで本番会議データと混ざるDBはない。

## 提案する境界

- 本番: 現行 `speak-attension` Workerと現在の `workers.dev` URLを維持する。
- preview: `speak-attension-preview` という別Workerを1つ事前作成し、独立した `workers.dev` URLを割り当てる。カスタムドメイン、ルート、KV/R2/D1等のbindingは付けない。
- `wrangler.toml` に `[env.preview]` と `workers_dev = true` を追加し、preview deployでは必ず `wrangler deploy --env preview` を使う。Wranglerはenvironmentごとに別Workerを作り、`speak-attension-preview` とpreview用 `workers.dev` URLを使う。
- UIに外部認証や実データの接続先が将来入る場合、preview資格情報・DBを本番と分ける設計審査を追加する。

## ワークフロー案

1. すべてのPRで、秘密情報を使わないCI（型検査、Vitest、build、Playwright）を実行する。
2. 外部forkを含む一般の `pull_request` ではCloudflare Secretsを利用しない。
3. previewへのdeployは、レビュー済みの信頼できるブランチに対する明示的な手動実行、または保護された専用ブランチへのpushに限る。
4. GitHub Environment `preview` の承認ルールを利用できる場合は、デプロイ実行者と承認者を分ける。
5. preview用Worker名を固定し、production向けの既存デプロイworkflowからpreview Workerに到達できないようにする。
6. previewで、会議作成→発言入力→確定取消→保存・再読み込み・復元→Dashboard→Markdown/JSONを確認する。
7. PR終了後、preview WorkerとEnvironment Secretを削除または無効化できる手順を用意する。

## 資格情報と最小権限

- `CLOUDFLARE_ACCOUNT_ID` はGitHub Actions Secretとして使う。
- deploy tokenはpreview Workerだけを更新できる最小権限とする。既存の本番用トークンを無条件で流用しない。
- preview Workerの初回作成にはCloudflareのWorkers product scopeで`Admin`権限が必要。作成後、CI tokenはpreview Worker個別scopeの`Editor`（Workers Scripts Edit相当）に限定する。production Workerやzoneの権限は付けない。
- GitHub Environment Secretsは `preview` 環境に限定し、本番Secretsと共有しない。
- 値は表示・ログ出力せず、チャットに貼り付けない。

アプリのWorkers runtimeに別のsecretはなく、preview API tokenとaccount IDはデプロイ用のGitHub Environment Secretとしてのみ扱う。Wranglerのenvironment secretsはenvironmentごとに独立し、継承されないため、将来runtime secretを追加する場合もpreview用の値を明示して設定する。

## ロールバック

- previewデプロイの失敗はpreview Workerの直前バージョンへ戻す。production Workerには影響しない。
- previewの誤デプロイ時はpreview workflowを停止し、Cloudflare側でpreview Workerの直前バージョンに戻す。
- production workflowの誤動作を避けるため、preview workflowは別workflowまたは明示的に分離されたenvironmentを使う。

## 実装前の確認事項

- CloudflareアカウントでWorkers product scopeの`Admin`を持つ担当者がpreview Workerを初回作成できるか。
- preview Worker作成後、個別Worker scopeの`Editor`を付けたCI用API tokenを発行できるか。
- GitHub Environmentの保護ルールが利用可能か。
- Wranglerの環境名・workers.dev URL・assets設定が現在のバージョンで期待どおり分離されるか。
- preview URLから本番Worker、実データ、秘密情報に接続しないこと。

これらを読み取り確認できるまで、設定追加やdeployを実行しない。
