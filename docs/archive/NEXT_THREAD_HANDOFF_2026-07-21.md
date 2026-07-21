# speak_attension - Next Thread Handoff (2026-07-21)

Last updated: 2026-07-21

## この文書の位置づけ

この文書が最新の引き継ぎ資料です。`NEXT_THREAD_HANDOFF.md` と `NEXT_THREAD_HANDOFF_2026-07-10.md` は会議の抜け漏れ検知を主役としていた時期、`NEXT_THREAD_HANDOFF_2026-07-14.md` はアイデアモード初期とレイアウト修正時点の履歴です。現在の実装状態の正は `docs/STATE.md`、コードの入口は `docs/CODE_GUIDE.md`、設計判断は `docs/adr/` を参照してください。

## 現在のプロダクト方針

- 主モードはアイデア出し、副モードは会議ダッシュボード。
- 利用形態はファシリテーター1人が操作し、参加者へ画面共有するローカルWebアプリ。
- 複数端末の同時編集、クラウド公開、認証、DB保存は対象外。
- LLMはローカルのLM Studioだけを利用し、失敗時は必ずルールベース結果を維持する。
- リアルタイムの発話処理はルールベースのまま。LLMはグループ化や会議後整理などの非同期後処理だけで使う。

## 今回実装した内容

### 1. アイデアの3状態管理とグループ編集

- キーワードの2値だった採用状態を `adopted` / `hold` / `rejected` に変更。
- 初期状態は保留。マップクリックでは 保留 → 採用 → 却下 の順に循環し、右側の一覧では状態を直接指定できる。
- グループ名を選択フェーズ中に編集できる。
- Markdownは採用・保留・却下をグループ別に出力する。
- セッションJSONは `version: 2`。3状態と会議出典を保持する。

中核は `src/utils/ideaSession.ts`、ストアは `src/hooks/ideaSessionStore.ts`、UIは `src/components/IdeaModeView.tsx`。

### 2. 会議の課題からアイデア出しへ引き継ぐ

- 会議整理マップの「課題」「未解決」項目に選択チェックを追加。
- 選択後に「選択した課題でアイデア出し」を押すと、根拠発言からcaptureフェーズの新セッションを開始する。
- 同じ発言が複数項目の根拠でも、発言自体は重複させず複数の参照を付ける。
- 出典には会議ID、議題ID/タイトル、整理項目ID/タイトル/カテゴリ、発言IDを保持する。
- `App.tsx` がアイデアストアを保持するため、モード切替をまたいで引き継ぎセッションを注入できる。

設計判断は `docs/adr/0006-connect-meeting-issues-to-idea-sessions.md`。

### 3. マップを見失ったときの復帰導線

- アイデアマップ、会議ライブマップ、会議整理マップの3画面で `MapViewportControls` を共用。
- 常時表示の「全体を表示」で全ノードを画面内へ戻せる。標準の判別しづらいfitアイコンは隠し、`+` / `-` は残した。
- パンは自由のまま。通常発言でノードが増えてもカメラ位置を勝手に変更しない。
- 自動fitは初回、アイデアのフェーズ切替、会議整理の再生成時だけ。
- 固定座標のアイデアノードはドラッグ不可にし、キャンバスのパンとキーワードの状態選択だけを許可した。

共通UIは `src/components/MapViewportControls.tsx`。設計判断は `docs/adr/0007-map-navigation-and-shared-display-ux.md`。

### 4. 会議ライブマップの左右配置

- 以前は全議題を1列に積んでいたが、中央の会議ルートから左右へ広がる構成へ変更。
- 各議題のノード高と表示中の発言ブロック高から枝の高さを求め、左右の累積高が小さい側へ決定的に配置する。
- 議題は中央寄り、発言は各議題の外側へ時系列に配置する。
- `GraphTopicNodeData.branchSide` を追加し、左右に応じてHandle位置とEdgeの `sourceHandle` / `targetHandle` を切り替える。
- 会議整理マップはカテゴリ階層を優先し、従来の左から右へ進むツリーを維持する。

純粋レイアウトは `src/utils/topicProjection.ts`。長い日本語ラベル、6議題、発言量の偏り、左右Handle、決定性を `topicProjection.test.ts` で保護している。

### 5. 会議画面のパネル整理

- 右レールを「進行」「分析」の2タブに変更。初期表示は「進行」。
- 「進行」には会議操作とTopicInspector、「分析」には抜け漏れレポートとLM Studio設定を配置。
- 下部は初期状態で閉じた「入力・再生」ドックに変更。
- ドック内は「手入力・シナリオ」「ファイル再生」「発話ログ」の3タブ。
- 非表示パネルもアンマウントしないため、入力途中の内容、レポート、リプレイ状態はタブ切替やドック開閉で失われない。
- `ControlPanel` の重複していた大見出しを「会議の進行」に簡略化。

画面構成は `src/App.tsx`、見た目は `src/styles.css`。

## READMEと利用想定

READMEを現状へ合わせて更新済みです。

- アイデア出しを主モード、会議支援を副モードとして説明。
- 打ち消し線で残っていた未実装機能を削除。
- 1人が操作して画面共有する利用想定を明記。
- 同時共同編集、クラウド公開、認証、DB保存に対応しないことを明記。
- 音声認識はWeb Speech API依存であり、音声データの扱いはブラウザ仕様によることを明記。

## Validation

2026-07-21時点の最終結果:

- `git diff --check`: passed
- `npm run check`: passed（20 test files / 111 tests）
- `npm run build`: passed
- `npm run dev`: client `http://127.0.0.1:5173/`、WebSocket `ws://127.0.0.1:8787` ともに起動確認済み
- 自動実画面確認: 実行環境に操作可能なブラウザが提供されず未実施

## Worktree State

- Branch: `feture/yukkurisiteikitai/speak_mindmap`
- HEAD: `829d62b feat: mindmap-stract`
- 今回の変更は未コミット。会議→アイデア連携とマップUX改善が同じworktreeに含まれている。
- ユーザー変更としてそのまま保持し、次担当者はresetやcheckoutで破棄しないこと。

主な新規ファイル:

- `docs/adr/0006-connect-meeting-issues-to-idea-sessions.md`
- `docs/adr/0007-map-navigation-and-shared-display-ux.md`
- `src/components/MapViewportControls.tsx`

## Known Limitations / Manual Check

- セッション状態はメモリのみで、リロードすると失われる。必要な結果はMarkdownまたはJSONへ保存する。
- マップのパン範囲は制限していない。迷子対策は常設の「全体を表示」で行う。
- 会議右タブと入力ドックはReact状態のみで、開閉状態をlocalStorageへ保存しない。
- Web Speech API、LM StudioのCORS、数百キーワード規模の放射状レイアウト性能に関する既知制約は継続。
- ブラウザが使える環境では、3マップを画面外へパンして「全体を表示」で復帰すること、通常発言追加で閲覧位置が変わらないこと、タブ切替後も入力・レポート状態が残ることを手動確認する。

## Recommended Next Work

1. ブラウザで今回のUX変更を手動確認し、ノートPC幅とデスクトップ幅で余白・タブ・ドックを調整する。
2. 実会議または代表リプレイで左右配置の読みやすさを確認する。特に1議題だけ発言が極端に多いケースを見る。
3. アイデア出しの実利用で採用・保留・却下の操作順とMarkdown出力が自然か確認する。
4. 変更を意味のまとまりごとにレビューした後、コミットまたはPR化する。

## Hard Constraints Reminder

- クラウドAI APIを追加しない。LLMは `http://127.0.0.1:1234/v1` のLM Studioのみ。
- LLM機能には必ずルールベースfallbackを残す。
- Deepgram、Whisper、独自STT、Python、DB永続化、認証、TTS、話者分離を追加しない。
- リアルタイムのセグメント処理へLLMを入れない。
- 変更後は `npm run check`、UIまたはビルド設定変更時は `npm run build` も実行する。
