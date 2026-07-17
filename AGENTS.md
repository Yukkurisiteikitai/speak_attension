# AGENTS.md

## What this is

アイデア出しを支援するローカル Web アプリです。主モードはアイデア出し、副モードは会議ダッシュボードです。音声または手入力からキーワードを集め、グループ化・選択・エクスポートできます。

## Read next

- [docs/STATE.md](docs/STATE.md): 現在の実装状態（現状の正）
- [docs/CODE_GUIDE.md](docs/CODE_GUIDE.md): コードの読み方とデータフロー
- [docs/adr/](docs/adr/): 設計判断の履歴（既存 ADR は変更しない）

## Hard constraints

- LLM はローカルの LM Studio（OpenAI 互換、`http://127.0.0.1:1234/v1`）だけを使用する。クラウド AI API は追加しない。
- LLM を使う機能には必ずルールベースの fallback を用意し、LLM がなくても全機能を使えるようにする。
- Deepgram、Whisper、独自 STT、Python、DB 永続化、認証、TTS、話者分離は追加しない。
- リアルタイムのセグメント処理はルールベースを維持する。LLM は非同期の後処理層だけで使う。

## Verify

変更後は必ず実行します。

```sh
npm run check
```

UI またはビルド設定に触れた場合は、続けて `npm run build` も実行します。

## Conventions

- エンジン層（`src/utils`）は純粋関数にする。ロジックを変える場合は、併置された `*.test.ts` を更新または追加する。
- 固定座標レイアウトを変える場合は、レイアウトテストと代表的な長短ラベルのケースを確認する。
- UI は内部 ID ではなく日本語ラベルを表示する。

## Editing docs

- 実装状態が変わったら [docs/STATE.md](docs/STATE.md) を更新する。このファイルには重複させない。
- 方針を決めたら `docs/adr/` に新しい ADR を追加する。既存 ADR は書き換えない。
