# attension_mindmap - Next Thread Handoff

Last updated: 2026-07-09

## プロダクトの方向性(最重要・2026-07-08 に確定)

このプロダクトの価値の核は **トピックグラフではなく「抜け漏れ検知」** である。サービス定義は:

> 決まっていないことを、会議が終わる前に教えてくれるツール。

確定した戦略判断:

- 議事録要約(Otter, tl;dv 等)はコモディティ。「まだ決まっていないことをリアルタイムに指摘する」領域で勝負する。
- リアルタイム化より先に **判定品質の証明** をやる。実会議のトランスクリプトを事後投入して「抜け漏れレポート」を出し、指摘の納得率を測る。
- 納得率(助かった率)**7割** がサービスとして成立するかの分水嶺。再現率より適合率優先。的外れな指摘は一発で信頼を失う。
- 実装順序は **1→3→2**: (1) 事後レポート生成 → (3) 納得率フィードバック収集 → (2) LLM 判定層。
- **LLM はクラウド API を使わず、LM Studio(ローカル、OpenAI 互換 API)限定。** リアルタイムのセグメント処理パイプラインはルールベースのまま維持し、LLM は事後レポート層でのみ使う。
- グラフ UI は削除しないがサブビューへ降格方針。日常利用の主役はチェックリストとアラート。
- 捨てるもの: 代名詞解決の精度追求、グラフレイアウト改良、独自 STT、放射状レイアウト。

この判断の経緯は 2026-07-08〜09 のセッションで議論済み。ユーザー(結仁)の合意済み。

## Current State

Vite + React + TypeScript のローカルプロトタイプ。日本語会議のトピック抽出・カバレッジ追跡・gap 生成に加えて、**2026-07-09 のセッションで以下の3層を実装済み**:

1. **抜け漏れレポート生成** (`src/utils/meetingReport.ts`)
   - 会議終了時点の全トピックに対して `buildTopicGaps` で gap を再計算(アクティブなまま終わったトピックは close 処理が走らず gap が出ないため、レポート生成時に全確定させる)
   - トピックに紐付かず流れた重要発言(問題提起/リスク/TODO/決定/疑問)を「未回収の指摘」として findings 化
   - finding の id は決定的(`${topicId}-${gapType}` / `mention-${segmentId}-${type}`)なので再生成してもフィードバックが引き継がれる
   - 高/中/低優先でグループ化した Markdown を出力、証拠発言を引用

2. **納得率フィードバック** (`src/utils/reportFeedback.ts`)
   - 各指摘に「助かった/ノイズ」をマーク(localStorage 永続化、キー: `speak_attension.feedback.{meetingId}.{generatedAt}`)
   - 納得率 = helpful ÷ 評価済み。パネルに表示
   - 「評価データ」ボタンで指摘+人間の判定+LLM 判定を束ねた JSON をエクスポート → **これが将来のルール調整・プロンプト改善のベンチマークデータセットになる**(事後レポートは正解データを作る装置でもある、という位置づけ)

3. **LLM 判定層(LM Studio)** (`src/utils/llmClient.ts` + `src/utils/llmGapReview.ts`)
   - OpenAI 互換クライアント。デフォルト `http://127.0.0.1:1234/v1`。`/models` で接続確認+モデル自動選択
   - トピック単位でグループ化し、証拠発言+ルール検出済み findings を渡して confirm/drop 判定と見落とし追加(`llm_added`)を JSON で受け取る
   - リクエストは逐次実行(ローカルサーバは並列生成できないため)。1グループ失敗しても他は続行し、失敗グループのルール findings はそのまま残る
   - **ルールベースの指摘を LLM は削除できない設計**。drop は注記+薄表示のみ(適合率優先・信頼維持の方針の実装)
   - code fence や前置きテキスト付き応答に耐える JSON パーサ(`extractJsonObject`)

UI は `src/components/MeetingReportPanel.tsx`(utility-grid 内)。レポート生成 / Markdown DL / 評価データ DL / LM Studio 設定(localStorage 永続化)/ 接続確認 / LLM レビュー / 指摘ごとの評価ボタン。

また、engine state の `segments` は UI 用に直近80件で切り捨てられるため、store に **`segmentArchive`**(全セグメント保持)を追加した。レポートの証拠引用はこちらを使う。

## How To Run

```sh
npm install
npm run dev
```

- App: `http://127.0.0.1:5173/`
- WebSocket: `ws://127.0.0.1:8787`
- ポートが塞がっていたら: `scripts/kill-localhost-port.sh 5173 5174 8787`

### LM Studio(LLM レビューを使う場合)

1. LM Studio でモデルをロードし、ローカルサーバを起動(デフォルト `http://127.0.0.1:1234/v1`)
2. **LM Studio のサーバ設定で CORS を有効にする**(ブラウザから直接 fetch するため必須)
3. アプリの「抜け漏れレポート」パネル → 接続確認(最初のモデル id が自動入力される)→ レポート生成 → LLM レビュー

## Validation

Latest verified results (2026-07-09):

- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm test`: passed, 9 files / 37 tests
- `npm run build`: passed

## Important Files

今回追加分:

- `src/utils/meetingReport.ts` - レポート構築 (`buildMeetingReport`) と Markdown 描画 (`renderMeetingReportMarkdown`)。型: `MeetingReport`, `MeetingReportFinding`(kind: `topic_gap` | `important_mention` | `llm_added`)
- `src/utils/reportFeedback.ts` - `summarizeFeedback`(納得率)と `buildEvaluationDataset`(評価データ JSON)
- `src/utils/llmClient.ts` - `LlmSettings`, `requestChat`, `fetchModelIds`, `extractJsonObject`
- `src/utils/llmGapReview.ts` - `reviewReportWithLlm`(グループ単位の LLM 検証)、`parseGapReviewResponse`、システムプロンプト
- `src/components/MeetingReportPanel.tsx` - レポート UI 一式
- `src/utils/meetingReport.test.ts` / `reportFeedback.test.ts` / `llmGapReview.test.ts` - 新規テスト16件

既存の中核(変更なし or 小変更):

- `src/hooks/topicEngineStore.ts` - **変更あり**: snapshot に `segmentArchive: AnalyzedSegment[]` を追加(applyTransition で追記、reset でクリア)
- `src/hooks/useTopicEngine.ts` - **変更あり**: `segmentArchive` を公開
- `src/App.tsx` - **変更あり**: `MeetingReportPanel` を utility-grid に追加
- `src/styles.css` - **変更あり**: report/finding/verdict/severity-badge 系のスタイル追記(末尾の media query 直前)
- `src/utils/topicEngine.ts` - セグメント処理オーケストレータ(1セグメント → 状態遷移)
- `src/utils/topicCoverage.ts` - カバレッジ検出・gap 生成(`buildTopicGaps` をレポートが再利用)
- `src/utils/topicLifecycle.ts` - close 処理・important mention 生成
- `src/utils/intentRules.ts` - 発話 intent 分類
- `src/utils/transcriptImporter.ts` - リプレイ JSON の検証付きインポート
- `src/components/TranscriptReplayPanel.tsx` - タイムライン再生(1x/2x/5x/instant)

## Processing Flow

リアルタイム/リプレイ共通(従来通り、ルールベース):

```txt
speech final text / manual text / replay item
-> processSegment -> intent検出 -> トピック抽出/マッチ -> カバレッジ更新
-> 休眠トピック close -> gap生成 -> React Flow投影
(全セグメントを segmentArchive にも追記)
```

事後レポート(今回追加):

```txt
「レポート生成」クリック
-> buildMeetingReport(meetingGraph, importantMentions, segmentArchive)
   - 全トピックの gap を buildTopicGaps で再計算(未closeトピックも確定)
   - relatedTopicId が null の importantMention を「未回収の指摘」化
-> UI に findings 表示、helpful/noise 評価(localStorageに保存)
-> (任意) reviewReportWithLlm: トピックグループごとに LM Studio へ検証依頼
-> Markdown / 評価データ JSON をダウンロード
```

評価データ JSON の形(`EvaluationDataset`): version, meetingId, reportGeneratedAt, summary(納得率), entries[](findingId, kind, gapType, topicTitle, severity, title, detail, evidence, verdict, llmVerdict, llmReason)。

## Tests

9 files / 37 tests:

- `src/hooks/topicEngineStore.test.ts`
- `src/utils/topicRules.test.ts`
- `src/utils/intentRules.test.ts`
- `src/utils/readerGuide.test.ts`
- `src/utils/topicEngine.test.ts`
- `src/utils/transcript-importer.test.ts`
- `src/utils/meetingReport.test.ts` (new)
- `src/utils/reportFeedback.test.ts` (new)
- `src/utils/llmGapReview.test.ts` (new — LLM 呼び出しはモック注入。実サーバ不要)

## Known Limitations

- ルールベース検出は単純なパターンマッチ。`buildTopicGaps` は coverage の組み合わせだけで gap を出すため、1〜2発言のトピックには `shallow` + `missing_decision` が機械的に付きやすい(ノイズ源。納得率測定で最初に問題になる見込み)
- LLM レビューはブラウザから直接 fetch するため LM Studio 側の CORS 有効化が必須
- LLM の `additional` findings には証拠引用が付かない(evidence: [])
- フィードバックは localStorage のみ。エクスポートし忘れるとブラウザ依存
- state はメモリのみ、リロードで消える(segmentArchive も同様)
- Web Speech API は Chrome 系推奨

## Recommended Next Work(優先順)

1. **実会議トランスクリプト3〜5本で納得率を測る。** これが分水嶺の数字。ルール調整より LLM プロンプト改善より先。測定時のバイアス対策: 指摘を見る前に参加者自身に「この会議で決まらなかったことは?」を書き出させ、ツール出力と突合する形が望ましい。
2. 手元の録音/字幕データ → リプレイ JSON への変換スクリプト(`transcriptImporter` の受理形式は `transcript-importer.test.ts` 参照)。
3. 納得率データを見てから: `shallow` 系のノイズ削減(閾値調整 or LLM drop 判定をフィルタに昇格させるか判断)。
4. LLM プロンプト改善(評価データセットと突合して confirm/drop の精度を測る)。
5. 会議終了5分前アラート(リアルタイム版のキラー機能)は判定品質証明の後。

## Notes For Next Agent

- **制約の更新(2026-07)**: クラウド AI API は引き続き禁止だが、**ローカル LLM(LM Studio, OpenAI 互換)は事後レポート層に限り許可**。リアルタイムパイプラインはルールベース維持。docs/next_plan.md の Non-Goals にも注記済み。
- Deepgram, Whisper, Python, DB, auth, TTS, 話者分離は引き続き追加しない。STT は自作しない方針(将来は Zoom/Meet の字幕 API から取る)。
- finding id は決定的なので、フィードバックの突合キーとして安定。id 生成規則を変えると過去の評価データと突合できなくなる点に注意。
- `npm run dev` がポート衝突で失敗したら `scripts/kill-localhost-port.sh 5173 5174 8787`。
- 動作確認の最短ルート: Transcript Replay に JSON を読ませて instant 再生 → レポート生成。
