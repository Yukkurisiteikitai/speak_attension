# 設計書: AI-Agent に適したリポジトリ構成への再設計

作成日: 2026-07-17
対象リポジトリ: speak_attension (live-topic-graph)
ステータス: 提案(未実施)

## 1. 目的

Claude Code / Codex などのコーディングエージェントがこのリポジトリで作業するとき、
**人間の口頭説明なしで「現在の正しい状態・制約・検証方法」に到達できる**構成にする。

エージェントにとっての良いリポジトリの条件は次の4つに集約される。本設計書はこの4条件を満たすための具体案である。

1. **単一のエントリポイント**: どのエージェントでも最初に読むファイルが1つに決まっている
2. **鮮度の保証**: 「現在の状態」と「過去の記録」が構造的に分離されていて、古い指示を現在の指示と誤読しない
3. **機械的な検証ループ**: 変更の正しさをエージェント自身がコマンドで確認できる
4. **明文化されたガードレール**: やってはいけないこと(クラウドAPI禁止など)が一箇所に書かれている

## 2. 現状評価

### 2.1 すでに強い点(変えない)

- **純粋関数エンジン + 併置テスト**: `src/utils/*.ts` に対して `*.test.ts` が同居し、
  リプレイ用 fixture で決定的にテストできる。エージェントが最も安全に触れる構造。
- **検証コマンドが揃っている**: `npm run typecheck` / `npm test` / `npm run build` が高速に回り、
  CI (`.github/workflows/ci.yml`) が lint → typecheck → test → build を全 push で実行する。
- **レイヤ分離が明確**: UI (components) / Store (hooks) / Engine (utils) の3層で、
  `docs/CODE_GUIDE.md` にデータフローが文書化済み。
- **TypeScript strict + 小さい依存**: 依存が React / React Flow / ws 程度で、環境再現が容易。

### 2.2 課題(本設計の対象)

| # | 課題 | 具体例 | エージェントへの影響 |
|---|------|--------|---------------------|
| C1 | エントリポイントが分裂 | `CODEX.md`(Codex用)、`HANDOFF.md`、`CLAUDE.md` は不在 | エージェントごとに読む文書が違い、内容もズレている |
| C2 | 鮮度の矛盾 | `CODEX.md` は「Focus stabilization phase」で `docs/NEXT_THREAD_HANDOFF.md` を read せよと指示するが、`HANDOFF.md` はその文書を「historical(ピボット前)」と明言している | エージェントが会議モード時代の方針(2026-07-08確定の「抜け漏れ検知が核」)を現在の方針と誤解し、アイデア出しモード(2026-07 再ピボット)と逆方向の変更をしうる |
| C3 | ハンドオフ文書の増殖 | `docs/NEXT_THREAD_HANDOFF.md` / `_2026-07-10.md` / `_2026-07-14.md` の3世代が並存。どれが現行かはファイル名から判別不能 | 最新を特定するのに全文書の読み比べが必要 |
| C4 | 計画文書の期限切れ | `docs/next_plan.md` は v0.2(会議モード時代)の計画のまま | 完了済み・方針転換済みのタスクを再実行するリスク |
| C5 | ガードレールの分散 | 「LM Studio限定・クラウドAPI禁止・ルールベースfallback必須」が CODEX.md / HANDOFF.md / 各ハンドオフに重複記載され、微妙に表現が違う | 更新漏れで矛盾が生じる(すでに C2 で発生) |
| C6 | CODE_GUIDE の片肺 | `docs/CODE_GUIDE.md` の Read This First が会議モード系ファイルのみで、現在の主役であるアイデア出しモード(`ideaSession` / `ideaGrouping` / `ideaLayout` / `IdeaModeView`)を案内していない | 主機能のコード理解に遠回りが発生 |

## 3. 設計方針(原則)

- **原則1: Single Source of Truth**。事実は1ファイルにのみ書き、他のファイルはそこへのポインタにする。
  重複記載は必ず腐るため禁止。
- **原則2: 「現在」と「歴史」をディレクトリで分ける**。ファイル名の日付や本文中の
  「これは historical」という注記に頼らず、`docs/adr/`(不変の決定記録)と
  ルート直下の現行文書(常に最新に保つ)に構造で分離する。
- **原則3: エージェント向け文書は短く、コードとテストに委譲する**。仕様の詳細は
  テスト(`*.test.ts`)と型(`src/types/`)が正であり、文書は「どこを読むか・何を守るか・どう検証するか」だけを書く。
- **原則4: 破壊的な整理はせず、移動とポインタ化で行う**。過去のハンドオフは決定の経緯として価値があるため削除しない。

## 4. 具体設計

### 4.1 文書構成(after)

```
AGENTS.md                     ← 唯一のエージェント用エントリポイント(新規)
CLAUDE.md                     ← "See AGENTS.md" のみ(新規・1行)
CODEX.md                      ← "See AGENTS.md" のみに置換
README.md                     ← 人間向け。現状維持
docs/
  CODE_GUIDE.md               ← アイデア出しモードを主、会議モードを従に更新
  STATE.md                    ← 現在の実装状態(旧 HANDOFF.md を改名・常に最新を維持)
  adr/
    0001-focus-gate-and-rule-based-engine.md   ← 旧 NEXT_THREAD_HANDOFF.md から抽出
    0002-pivot-to-gap-detection-2026-07-08.md  ← 「抜け漏れ検知が核」の決定
    0003-local-llm-only-lm-studio.md           ← LM Studio限定・fallback必須の決定
    0004-pivot-to-idea-mode-2026-07.md         ← アイデア出し特化への再ピボット
  archive/
    NEXT_THREAD_HANDOFF.md            ← そのまま移動
    NEXT_THREAD_HANDOFF_2026-07-10.md ← そのまま移動
    NEXT_THREAD_HANDOFF_2026-07-14.md ← STATE.md に反映後、移動
    next_plan.md                      ← そのまま移動(v0.2計画は完了済み)
```

### 4.2 AGENTS.md の内容設計

`AGENTS.md` は業界標準のエージェント用エントリポイント名であり、Codex・Claude Code 双方が認識する。
100行以内に収め、以下の6セクションのみで構成する。

```markdown
# AGENTS.md の構成(骨子)

## What this is
1段落。アイデア出し支援ローカルWebアプリ。主モード=アイデア出し、副モード=会議ダッシュボード。

## Read next
- docs/STATE.md      … 現在の実装状態(これが正)
- docs/CODE_GUIDE.md … コードの読み方
- docs/adr/          … なぜこうなっているか(変更しないこと)

## Hard constraints(ガードレール・唯一の記載場所)
- LLM はローカル LM Studio(OpenAI互換, http://127.0.0.1:1234/v1)限定。クラウドAI API 禁止
- LLM を使う機能はすべてルールベース fallback 必須(LLM 不在でも全機能が動くこと)
- 追加禁止: Deepgram/Whisper/独自STT, Python, DB永続化, 認証, TTS, 話者分離
- リアルタイムのセグメント処理パイプラインはルールベースを維持(LLM は非同期の後処理層のみ)

## Verify(変更後に必ず実行)
npm run typecheck && npm test && npm run build

## Conventions
- エンジン層(src/utils)は純粋関数。ロジック変更は必ず併置テストを更新/追加
- 固定座標レイアウトを触るときはレイアウト系テストと fixture の代表性を確認
- UI は内部 id でなく日本語ラベルを表示

## Editing docs
- 実装状態が変わったら docs/STATE.md を更新(このファイルと重複させない)
- 方針決定をしたら docs/adr/ に追記(既存 ADR は書き換えない)
```

ポイント:

- **ガードレールは AGENTS.md にのみ書く**(原則1)。STATE.md や CODE_GUIDE.md からは参照のみ。
- **検証コマンドを明記**することで、エージェントが自律的に green を確認してから終了できる。

### 4.3 STATE.md(現行状態文書)の設計

旧 `HANDOFF.md` の役割を引き継ぐが、次のルールで運用する。

- 「最終更新日」を冒頭に必ず記載
- 「現在何ができるか」「現在のフェーズ」「既知の未解決課題」の3節のみ
- **経緯・理由は書かない**(ADR へ切り出す)。これにより文書が肥大化せず、常に上書き更新できる
- セッション終了時のハンドオフは新ファイルを作らず STATE.md を上書きする
  (git 履歴が世代管理を担うため、日付付きファイルの増殖が止まる)

### 4.4 ADR(Architecture Decision Records)の設計

既存ハンドオフ文書に埋もれている確定判断を、1決定=1ファイルで不変の記録として抽出する。
フォーマットは軽量に:

```markdown
# NNNN: タイトル
Date: YYYY-MM-DD / Status: accepted (superseded by NNNN)
## 決定
## 背景
## 影響(何をやめたか・何を守るか)
```

初期セットは §4.1 の4件。ピボットのように**過去の決定を覆す場合は既存 ADR を編集せず、
新 ADR で supersede する**。これがエージェントの「古い方針の誤読」(課題 C2)への構造的な対策になる。

### 4.5 CODE_GUIDE.md の更新設計

- Read This First をモード別の2列に再編:
  - **アイデア出しモード(主)**: `App.tsx` → `hooks/ideaSessionStore.ts` → `utils/ideaSession.ts` → `utils/ideaExtraction.ts` → `utils/ideaGrouping.ts` → `utils/ideaLayout.ts` → `components/IdeaModeView.tsx`
  - **会議モード(副)**: 既存の列を維持
- データフロー図をアイデア出しモードについても追加
- ファイルマップに LLM 層(`llmClient.ts` / `llmGapReview.ts` / `llmTopicTitle.ts`)と
  「fallback がどこで効くか」を1行ずつ追記

### 4.6 検証ループの強化(小さい追加のみ)

現状の CI は十分強い。エージェント作業効率のための追加は2点に留める。

1. **`npm run check` の追加**: `tsc --noEmit && vitest run` を1コマンド化。
   AGENTS.md の Verify 節から参照する(build は時間がかかるため任意扱い)。
2. **fixture の場所と役割を CODE_GUIDE.md に明記**: リプレイ fixture がどのテストの正解データか、
   fixture を更新すべき変更の種類は何か(トピック/フォーカス挙動の変更時)を表にする。

Lint 導入(ESLint/Biome)は任意。現在 `lint` script が実質 typecheck の別名である点は
誤解を招くため、導入しない場合は script 名を `lint` → 削除 or `typecheck` へ統一する。

### 4.7 スコープ外(やらないこと)

- コード構造の変更(3層構造は既に良い)
- テストフレームワーク・ビルド設定の変更
- `some_designs/` の整理(CODEX.md の注記どおり無関係な作業領域のため放置)
- GitHub Issue テンプレート等のプロセス整備(個人開発の現段階では過剰)

## 5. 移行計画

| フェーズ | 作業 | 所要 | リスク |
|---------|------|------|--------|
| P1 | `AGENTS.md` 新規作成、`CLAUDE.md`/`CODEX.md` をポインタ化 | 小 | なし(追加のみ) |
| P2 | `HANDOFF.md` → `docs/STATE.md` へ改名・整形(経緯を削り現在形に) | 小 | なし |
| P3 | ADR 4件を既存ハンドオフから抽出、`docs/archive/` へ旧文書移動 | 中 | 抽出時の解釈ミス → 元文書は archive に残るため復元可能 |
| P4 | `docs/CODE_GUIDE.md` をアイデア出しモード主体に更新 | 中 | なし |
| P5 | `npm run check` 追加、`lint` script の整理 | 小 | CI の script 名参照を同時更新 |

P1 だけでも課題 C1/C2/C5 の大部分(エントリポイント統一とガードレール一元化)が解消するため、
P1 を最優先とする。P2〜P5 は独立しており任意の順で実施できる。

## 6. 受け入れ基準

移行完了後、次がすべて成立すること。

1. リポジトリを初見のエージェントが `AGENTS.md` だけ読めば、現在の製品方向(アイデア出し特化)・
   禁止事項・検証コマンドを誤りなく述べられる
2. 「LM Studio 限定」「fallback 必須」等のガードレールの記載箇所が `AGENTS.md` の1箇所のみである
   (他文書は参照のみ)
3. `docs/` 直下に「historical」と自称する文書が存在しない(歴史は `adr/` と `archive/` にのみある)
4. `git grep -l "NEXT_THREAD_HANDOFF" -- ':!docs/archive'` がエントリポイント類でヒットしない
5. `npm run check` 一発で typecheck + test が通る
