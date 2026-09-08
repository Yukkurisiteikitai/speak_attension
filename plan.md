You are modifying an existing application called `live-topic-graph`.

First inspect the repository, understand the current architecture, data model, React Flow graph, WebSocket flow, speech input pipeline, phase management, and tests. Do not rewrite the application from scratch.

The current app is a meeting / brainstorming application with roughly this flow:

- アイデア出し
- グループ化
- 採用・却下

It already has:
- React/Vite/TypeScript frontend
- React Flow based idea map
- server-side WebSocket processing
- speech / text input
- idea grouping
- facilitator controls
- meeting phases
- meeting timer
- tests

The next product direction is NOT simply "better meeting minutes".

The goal is to turn the app into a `Meeting State / Decision Graph` system.

# Product definition

At any point during or after a meeting, a user should be able to answer within a few seconds:

1. 今、何をすべきか？
2. なぜそれをすべきか？
3. なぜ「今」なのか？
4. その判断は何を根拠にしているか？
5. 誰がその判断をしたか？
6. 元の発言は何だったか？
7. 何がまだ未決定なのか？

The graph must therefore support BOTH directions:

Forward:
Utterance
→ Evidence / Reason
→ Proposal
→ Decision
→ Action
→ Outcome

Reverse:
Action
→ Decision
→ Reason
→ Evidence
→ Original Utterance

The reverse direction is particularly important.

In urgent situations, the primary UI should initially show:

WHAT
何をするか

WHY
なぜするか

WHY NOW
なぜ今する必要があるか

OWNER
誰が担当するか

DEADLINE
いつまでか

and then allow the user to drill backward into the reasoning and original meeting evidence.

# Core principle

Do NOT treat an Action as merely a leaf node at the end of the graph.

Action is also an ENTRY POINT into the graph.

A user should be able to open an action and repeatedly ask:

「なぜ？」

Example:

Action
「本番環境をv1.42へロールバック」

↓ why?

Decision
「現在のv1.43を停止する」

↓ why?

Reason
「継続運用によるデータ破損リスクが復旧コストを上回る」

↓ evidence?

Evidence
- DB write corruption 3件
- v1.43 deploy直後からerror rate上昇

↓ source?

Utterance
14:22 山田
「DBのwriteで3件壊れています」

The source transcript / utterance must remain traceable.

# Data model

First inspect the current data model and adapt it rather than replacing everything unnecessarily.

Introduce or evolve the graph toward typed nodes.

At minimum support concepts equivalent to:

- utterance
- question
- fact / evidence
- proposal
- argument / reason
- concern / risk
- decision
- action
- outcome

A possible TypeScript shape is:

type MeetingNodeType =
  | 'utterance'
    | 'question'
      | 'evidence'
        | 'proposal'
          | 'reason'
            | 'concern'
              | 'risk'
                | 'decision'
                  | 'action'
                    | 'outcome';

                    Every derived node should support provenance.

                    For example:

                    interface Provenance {
                      utteranceIds: string[];
                        createdBy: 'human' | 'ai';
                          confidence?: number;
                          }

                          Actions need more structured information:

                          interface ActionData {
                            what: string;
                              why?: string;
                                whyNow?: string;
                                  owner?: string;
                                    deadline?: string;
                                      urgency?: 'low' | 'medium' | 'high' | 'critical';
                                        status?: 'proposed' | 'decided' | 'in_progress' | 'done';
                                        }

                                        Do not blindly use these exact interfaces if the existing architecture suggests a cleaner compatible implementation.

                                        # Human decision vs AI inference

                                        This distinction is mandatory.

                                        Never visually or semantically treat an AI suggestion as if the meeting decided it.

                                        Support states equivalent to:

                                        - Decided
                                          explicitly decided by participants

                                          - Proposed
                                            proposed by a participant

                                            - AI Suggested
                                              inferred/recommended by AI

                                              - Unconfirmed
                                                AI believes it may exist, but evidence is insufficient

                                                The UI must make these distinguishable.

                                                If confidence is low, preserve uncertainty instead of inventing certainty.

                                                # Urgency

                                                Urgency should not just be a red color on an action.

                                                The system needs to represent WHY an action is urgent.

                                                Conceptually:

                                                Evidence
                                                ↓
                                                Risk
                                                ↓
                                                Urgency / why now
                                                ↓
                                                Decision
                                                ↓
                                                Action

                                                Example:

                                                Evidence:
                                                「1分ごとに破損レコードが増えている」

                                                Risk:
                                                「継続するとデータ損失が拡大する」

                                                Why now:
                                                「待つほど被害量が増える」

                                                Action:
                                                「直ちに書き込みを停止する」

                                                An action can therefore be critical because of a traceable causal chain.

                                                # Meeting state

                                                The application should gradually evolve toward maintaining a live state like:

                                                MeetingState
                                                ├─ goal
                                                ├─ activeTopics
                                                ├─ questions
                                                │  ├─ open
                                                │  └─ resolved
                                                ├─ proposals
                                                ├─ criteria
                                                ├─ evidence
                                                ├─ concerns / risks
                                                ├─ decisions
                                                ├─ actions
                                                ├─ unknowns
                                                └─ outcomes

                                                Do NOT attempt to build an enormous autonomous AI system in one pass.

                                                Implement the minimum architecture necessary to make this model extensible.

                                                # UI

                                                Preserve the current visual identity and existing functionality as much as practical.

                                                Add a concept similar to a `NOW` / `Action View`.

                                                This should surface currently important actions.

                                                For an urgent action, a card could conceptually show:

                                                NOW

                                                本番環境をv1.42へロールバック

                                                理由:
                                                DB破損につながる異常が確認されている

                                                今やる理由:
                                                破損レコードが継続的に増加している

                                                担当:
                                                佐野

                                                期限:
                                                即時

                                                [なぜ？]
                                                [根拠を見る]
                                                [議論を見る]

                                                Do not treat this exact layout as mandatory.
                                                Adapt it to the existing UI.

                                                When clicking "なぜ？", the application should traverse the graph backward.

                                                Action
                                                → Decision
                                                → Reason
                                                → Evidence
                                                → Utterance

                                                The user should be able to continue drilling down rather than receiving a giant generated explanation.

                                                Think "progressive disclosure".

                                                # Graph behavior

                                                The graph should make relations explicit rather than relying only on spatial grouping.

                                                Edges should have semantic meaning where practical.

                                                Examples:

                                                - supports
                                                - opposes
                                                - answers
                                                - motivates
                                                - decided_from
                                                - results_in
                                                - assigned_to
                                                - derived_from

                                                Avoid adding complexity purely for ontology purity.

                                                The primary objective is traceability.

                                                # Important architectural requirement

                                                Do not make the LLM generate a fresh summary of the whole meeting every time.

                                                Think in terms of incremental Meeting State updates.

                                                New utterance:

                                                「それだと工事が遅くない？」

                                                should conceptually become something such as:

                                                Utterance
                                                ↓
                                                Concern
                                                「工事時期が遅い可能性」

                                                which updates the relevant discussion state.

                                                The desired mental model is:

                                                NOT:
                                                conversation → repeatedly regenerate summary

                                                BUT:
                                                conversation event → update structured meeting state

                                                Reuse the existing real-time architecture where appropriate.

                                                # Current phase system

                                                Do not immediately delete:

                                                1. アイデア出し
                                                2. グループ化
                                                3. 採用・却下

                                                Keep current behavior working.

                                                However, design the new model so the application is not permanently constrained to a strictly linear meeting process.

                                                Real meetings can move:

                                                問題定義
                                                → 探索
                                                → 比較
                                                → 判断
                                                → 再検討
                                                → 比較
                                                → 判断

                                                The state model should support this later.

                                                # Implementation strategy

                                                Work incrementally.

                                                First:

                                                1. Inspect repository architecture.
                                                2. Identify the existing graph/node model.
                                                3. Identify where ideas are created and updated.
                                                4. Identify WebSocket message schemas.
                                                5. Identify persistence/state ownership.
                                                6. Identify existing tests.

                                                Then propose the smallest coherent architecture change.

                                                After that, implement it.

                                                Prioritize this first vertical slice:

                                                speech/text input
                                                → meeting event
                                                → typed node(s)
                                                → Decision / Action relation
                                                → provenance
                                                → Action View
                                                → reverse traversal to source utterance

                                                It is acceptable for the first implementation to use manually created / deterministic example decision relations if the current AI pipeline cannot reliably extract them yet.

                                                The structural model and interaction should be correct before trying to solve perfect automatic extraction.

                                                # Acceptance scenario

                                                Create a test/demo meeting like this:

                                                14:20
                                                「新バージョンにしてからエラー率が35%になっています」

                                                14:21
                                                「新バージョンが原因かもしれない」

                                                14:22
                                                「DBのwriteで3件壊れています」

                                                14:23
                                                「このまま動かすと壊れたデータが増える」

                                                14:24
                                                「一度v1.42に戻そう」

                                                14:25
                                                「それでいこう。今すぐロールバック」

                                                The resulting state should allow the user to see roughly:

                                                ACTION
                                                v1.42へロールバック

                                                WHY
                                                データ破損を止める

                                                WHY NOW
                                                稼働を続けるほど破損が増える

                                                STATUS
                                                Decided

                                                and navigate backward to:

                                                Decision
                                                ↓
                                                Reason / Risk
                                                ↓
                                                Evidence
                                                ↓
                                                14:20 / 14:22 / 14:23 utterances

                                                # Acceptance criteria

                                                The implementation is successful when:

                                                - Existing core brainstorming flow still works.
                                                - Actions can exist as structured graph entities.
                                                - An Action can reference the Decision that caused it.
                                                - A Decision can reference supporting reasons/evidence.
                                                - Evidence can reference original utterances.
                                                - Reverse traversal works in the UI.
                                                - AI suggestions are visibly distinct from human decisions.
                                                - Urgency has an explainable `why now`, not only a severity value.
                                                - Missing evidence remains visibly missing/unconfirmed.
                                                - TypeScript checks pass.
                                                - Existing tests pass.
                                                - Add tests for the new graph relationships and reverse traversal.
                                                - Avoid unnecessary large refactors.

                                                # UX test

                                                A person who joined the meeting late should be able to open the application and answer:

                                                「今、何をすればいい？」

                                                within about 5 seconds.

                                                They should then be able to answer:

                                                「なんで？」

                                                within another few seconds.

                                                And if they distrust the summary, they should be able to trace the answer all the way back to the original utterances.

                                                That is the central product experience.

                                                # Before editing

                                                Inspect the repository first and give me:

                                                A. Current architecture relevant to this feature
                                                B. What should be reused
                                                C. What is structurally missing
                                                D. Proposed minimal implementation plan
                                                E. Files likely to change

                                                Then proceed with implementation unless you discover a major architectural contradiction that would make the proposed approach unsafe.
