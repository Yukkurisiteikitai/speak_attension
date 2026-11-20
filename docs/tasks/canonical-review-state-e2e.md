# Canonical確認状態のブラウザーE2E

## 実行

```sh
pnpm test:e2e
```

PlaywrightはローカルのViteサーバー（127.0.0.1:5178）とChromiumを使う。テスト用ブラウザーコンテキストのIndexedDBにだけ記録し、外部サービスや本番環境に接続しない。

## 対象

`tests/e2e/canonical-review-state.pw.ts` は、ユーザー操作で発言を入力し、会議を終了し、自動記録の取消しを実行する。項目が「要確認」となることを確認し、端末保存・再読み込み・復元を行う。その後、保存イベントを実際のCanonical/議事録/確認状態投影へ読み込み、Canonical graphが`unconfirmed`、議事録が`pending`であること、旧表示Dashboardに確定項目として現れないこと、JSON/Markdown出力が要確認を保持することを検証する。

`meetingState`フラグを有効化せず、画面が現在使う旧Dashboard投影とCanonical投影を同じブラウザーセッションで検査する。

## 制約

この自動化はUI/IndexedDB/投影経路の回帰テストであり、外部利用者の理解度、実会議の抽出品質、マイク・音声認識サービスのプライバシー、公開本番デプロイを検証しない。公開環境は別途、確認済みコミットと手動ブラウザーテストで照合する。
