# speak_attension

**会議で話が広がるのに結論が出せない人のための、ローカルWebアプリ。**

作者自身が会議進行の課題を解決するために作りました。会議の流れを可視化し、考えがどうまとまったか、次に何を確認すべきかを一体で示します。

## これは何か

speak_attensionは、会議の進行を支援するローカル Web アプリです。

- **主モード：会議支援** — 発言をリアルタイムで「話題 → 課題 → 原因 → アクション」の意味階層としてマップ化。進行中は「会議の状況」パネルに「現在地」「決定済み事項」「確認が必要な項目」「次にやること」を一覧表示。会議後は決定・課題・アクションを根拠発言付きで整理します。

- **副モード：アイデア出し** — 音声または手入力からキーワードを集め、放射状マップに表示。収集後はグループ化して階層マップに遷移し、グループ内の項目を採用・保留・却下に整理できます。結果は Markdown / JSON で出力。

## プロダクトの位置づけ

セルフホスト可能なローカル Web アプリです。会議状態は主にブラウザー内で処理し、任意の運用ログ保存とDiscord送信にはローカルHTTPサーバーを使います。データベースは使いません。

- **開発環境での実行**：`npm install && npm run dev` で `http://127.0.0.1:5173/` を開く
- **クラウド公開デモ**：<https://speak-attension.yourselfl.workers.dev/>（Cloudflare Workers でホスト）

セッション状態はリロードすると失われるため、必要な結果は Markdown または JSON で保存してください。

## LLM補助機能（オプション）

**未設定でもルールベースで全機能が使えます。**

ローカルの [LM Studio](http://127.0.0.1:1234/v1) を設定して利用できます。クラウドAI APIには送信しません。

- 会議中の質問候補の具体化
- 会議後の議題統合・要点化

AI が未設定・接続不可の場合は、ルールベース処理が自動的に機能します。モデルと接続先は localStorage に保存され、アイデア出しモードと会議モードで共有されます。

## セキュリティ

会議状態はリロードで失われます。LLM設定、アイデア出しメモ、レポート評価はブラウザーのlocalStorageに残り、運用ログはローカルサーバーの`logs/`に保存されます。

- LLM通信先はローカルLM Studioに限定します。音声認識の処理先は利用ブラウザーのWeb Speech APIの実装に依存します。
- 「Discordへ送信」を押すとレポート本文を設定済みのDiscord Webhookへ送ります。長いレポートは番号付きで分割します。
- ローカルHTTP APIは開発画面のOriginとJSON形式を検証します。これは別サイトからのブラウザー経由の送信を防ぐための制限で、ローカルプロセスの認証ではありません。

## 検証実績

決定グラフ（決定・課題・アクション抽出）の実装は、会議音声を基準テストで検証しています：

- **適合率** — 決定済みアクションの誤抽出を最小化しつつ、未解決の問い・未採用提案を正しく分類
- **処理速度** — 音声入力は発言確定後の最大 5000ms の滞留を解消（終端句読点で即時、無音約 800ms で取り込み）。「流れ・次の検討」マップは発話 1600 件付近でリアルタイム予算を超えることが分かっており、Phase 4 で解消予定

詳細は [`src/hooks/festivalGoldenMeeting.test.ts`](src/hooks/festivalGoldenMeeting.test.ts)、[`src/hooks/releaseDecisionMaterialsGolden.test.ts`](src/hooks/releaseDecisionMaterialsGolden.test.ts) を参照してください。

## 起動方法

### 開発環境で実行

```sh
npm install
npm run dev
```

`npm run dev` はフロントエンドとローカルHTTP APIサーバーを起動します。ブラウザで `http://127.0.0.1:5173/` を開いてください。ポート5173が使用中の場合、別ポートへ移らず起動に失敗します。

**音声入力を使う場合**：マイクの利用を許可してください（Web Speech API を使用）。

**Discord 通知を使う場合**：`sample.env` を `.env` にコピーし、`DISCORD_WEBHOOK_URL` を設定してください。会議レポート生成時に「Discord へ送信」から送信できます。

```sh
# 技術レポートを Discord へ送信
npm run report:discord

# コード変更後の検証
npm run check
```

### LLM エンドポイントの設定

アプリ起動後、画面内の「LLM 設定」から接続先を指定できます。

- **LM Studio（ローカル）**：`http://127.0.0.1:1234/v1`

## 利用想定

ファシリテーター 1 人がブラウザを操作し、参加者には画面共有または外部ディスプレイで見せる使い方を想定しています。**複数端末からの同時編集には対応していません。**

会議状態はブラウザ内で扱います。音声認識はブラウザの Web Speech API に依存するため、音声データの扱いは利用ブラウザの仕様を確認してください。

## 技術スタック

- React + TypeScript
- Vite
- React Flow
- Web Speech API
- ローカルHTTP API（運用ログ・Discord送信）
- Cloudflare Workers（公開デモ）

## 機能一覧

### 会議支援

- リアルタイム意味階層マップ（話題 → 課題 → 原因 → アクション）
- 「会議の状況」ダッシュボード — 現在地、決定済み、確認待ち、次のアクション
- 決定・課題・アクションの根拠発言表示
- トピック抽出、カバレッジ追跡
- 会議後レポート（Markdown / JSON 出力）
- 会議から課題を引き継いでアイデア出しを開始
- 手動レイアウト調整、高評価マーキング

### アイデア出し

- 音声入力または手入力からキーワード収集
- 放射状マップ → グループ化階層マップへの遷移
- グループ名編集、項目の採用・保留・却下
- Markdown / JSON 出力（3 状態と出典を保持）

### 実験的機能

- **設計仮説タブ** — 因果グラフエンジン、矛盾検知、質問提案

## ドキュメント

### 基本
- **[docs/STATE.md](docs/STATE.md)** — 現在の実装状態（現状の正）
- **[docs/CODE_GUIDE.md](docs/CODE_GUIDE.md)** — コード構成とデータフロー

### 設計思想
- **[docs/DESIGN_PHILOSOPHY.md](docs/DESIGN_PHILOSOPHY.md)** — Meeting State の概念、決定グラフの根拠追跡構造
- **[docs/IMPLEMENTATION_SPEC.md](docs/IMPLEMENTATION_SPEC.md)** — 意思決定支援機能の改修仕様と問題意識
- **[docs/RESEARCH_DESIGN.md](docs/RESEARCH_DESIGN.md)** — Voice Topic Graph と Design Hinge の研究設計書

### その他
- **[docs/adr/](docs/adr/)** — 設計判断の履歴
- **[docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md)** — 技術管理レポート（`npm run report:discord` で送信可能）
- **[docs/HANDOVER.md](docs/HANDOVER.md)** — 運用・障害調査・引き継ぎ記録

## Issue・フィードバック

不具合報告や改善案は GitHub Issues に以下を記載してください：

- 概要
- 再現手順（不具合の場合）
- 期待する動作と実際の動作
- 使用環境（ブラウザ・OS）
- スクリーンショット・エラーメッセージ（あれば）

## 連絡先

- X: [@ikari569](https://x.com/ikari569)（DM 受け付け）
- メール: yukkuriorsience@gmail.com
- 応答時間帯: 6:00〜22:00
