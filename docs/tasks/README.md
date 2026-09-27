# docs/tasks

クラウド実行（branch指定）向けの作業指示書を置く。

`docs/plans/` はgit管理外のため、別セッションやクラウド環境から参照できない。
このディレクトリの文書は **cold startのエージェントが単独で実行できるよう自己完結** させる。
対象作業が完了しPRがmergeされたら削除する。

## 進行中

| 指示書 | 内容 | 前提 |
|---|---|---|
| [semantic-core-phase0.md](semantic-core-phase0.md) | Phase 0: golden corpus + characterization tests | [ADR 0022](../adr/0022-semantic-core-and-central-promotion-policy.md) |
| [semantic-core-phase1.md](semantic-core-phase1.md) | Phase 1: Semantic Core types + sidecar parser | Phase 0 完了 |

Phase 2以降は Phase 1 の結果を見てから発行する。
