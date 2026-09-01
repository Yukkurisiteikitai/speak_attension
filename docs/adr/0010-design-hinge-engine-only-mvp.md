# 0010: design-hinge を独立エンジンとして追加する

Date: 2026-08-03
Status: accepted

## 決定

`deep_research.md`（Voice Topic Graph / Design Hinge の研究設計書）が提案するMVPアーキテクチャのうち、因果グラフ・介入ポリシー・イベントログ・Shadow Modeの部分だけを、新しいトップレベルディレクトリ `design-hinge/` として実装する。`src/` とは独立し、React に依存しない純粋関数エンジンとする。研究設計書の人間対象試験部分（統計・被験者募集・同意設計・IRB）は対象外とし、ソロ開発者によるドッグフーディング用のエンジンとして扱う。

`deep_research.md` のクラウド/DB前提のアーキテクチャは、本リポジトリの `AGENTS.md` hard constraints（ローカルLLMのみ・クラウドAI不可・DB永続化不可・認証不可・TTS不可・ルールベースfallback必須・リアルタイム処理はルールベース限定）を通して再解釈する。

| `deep_research.md` の要素 | 本実装での扱い | 理由 |
|---|---|---|
| OpenAI Realtime API / WebRTC / VAD | 不採用。既存の `useSpeechRecognition`（Web Speech API）のみ使用 | クラウドAI不可 |
| 音声での介入提示 | 不採用。カード提示のみ、常にユーザーの明示承認後に表示 | TTS不可。カードは本来「自動表示」だが、音声を代替できない以上、自動表示は音声と同等以上の割り込みリスクを持つため、明示承認へ倒す方が原文の意図（主体性の保護）に忠実 |
| PostgreSQL + JSONB + pgvector | セッション内メモリ保持 + JSONエクスポート（`design-hinge_session` 形式） | DB永続化不可。単一ローカルセッションではメモリで十分 |
| バックエンド認証・セッションサービス | 不採用 | 単一ローカル利用者、マルチテナントなし |
| Realtime/Extraction/Policy/Offline/Evaluation の5エージェント分割 | 同期のルールベースエンジン + 非同期LLM言い換え1系統に統合 | リアルタイム処理はルールベース限定 |
| Micro-Randomized Trial（ライブ50/50) | 不採用。Shadow Modeによるオフライン再評価で代替 | 対象外（人間対象試験）。単一利用者では無作為化の意味が薄い |
| グラフDB・5ホップ以上の探索 | 3ホップ制限のインメモリBFS | 原文が示すDB移行条件（数百万エッジ規模、作品横断検索等）に到達しないスケール |
| pgvectorのコサイン類似度 | Jaccard係数によるトークン一致（`graph/textSimilarity.ts`） | ローカル埋め込みモデルを対象外としたため |
| Phase-Aware / Adaptive Policy（強化学習) | 見送り | 4種のトリガー（孤立ノード・矛盾・沈黙・同内容反復）のみで最初のドッグフードには十分 |
| CAT・NASA-TLX・CSI・サンプルサイズ設計・IRB・被験者募集 | 対象外 | ソロ開発の実装作業であり、人間対象研究ではない |

## 背景

`deep_research.md` は音声ブレストを因果仮説グラフへ構造化し、AIの介入タイミング・形式を実験的に検証するための、複数人研究チーム・複数ヶ月規模の研究提案書である。本リポジトリは単一利用者向けのローカルWebアプリであり、研究設計書のアーキテクチャをそのまま採用すると `AGENTS.md` のhard constraintsと正面から衝突する。branch `feature/Yukkurisiteikitai/ResearchThroughDesign` はこの研究提案から着想を得た新機能を実験するために作成されたが、研究プロトコル部分（統計・被験者・倫理審査）は本リポジトリの開発体制と規模に合わないため、エンジン部分のみを抽出して実装した。

## 影響

- `design-hinge/` は `src/utils/llmClient.ts` のみを再利用し、他は意図的に重複実装する（例: `graph/textSimilarity.ts` は `topicExtraction.ts` の形を模倣するが import しない）。会議モード固有のチューニングと設計仮説エンジンのチューニングが互いに壊し合わないようにするため。
- ルールベース結果を先に同期的に確定し、LLMは言い換え（`policy/llmPhrasing.ts`）のみを非同期パッチとして適用する。`src/hooks/topicEngineStore.ts` の `processTitleRefineQueue` と同じ形。
- ノード・エッジの生成にLLMは一切関与しない（`graph/edgeCandidateExtraction.ts` は正規表現ベース）。
- 介入カードは `design-hinge/store/designHingeStore.ts` の `pendingCandidateQueue` / `activeCard` を経由し、`approveIntervention` が呼ばれるまで配信済み扱いにならない。
- 同一の未解決課題（同じ `reasonCode`）が tick のたびに再検出されても、`pendingCandidateQueue` / `activeCard` に既に存在する場合は再キューしない（`dedupeAgainstPending`）。`intervention_eligible` イベント自体は検出のたびに記録する。
- `tsconfig.json` の `include` に `design-hinge` を追加した。
- `docs/STATE.md` に現在の機能範囲を記載する。恒久的な設計判断はこのADRに残す。
