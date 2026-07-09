# Live Topic Graph v0.2 Implementation Plan

## Goal

Live Topic Graph v0.1 is working, but topic detection still looks like simple keyword counting.
Implement v0.2 so the app can explain topic classification with:

- manual Focus selection and lock
- utterance intent classification
- synonym / normalized-term scoring
- score breakdown in Decision Log
- explicit Focus auto-change rules that prevent accidental Focus stealing

Keep the prototype local, deterministic, and rule-based. Do not add OpenAI, Deepgram, Whisper, Python, database, auth, TTS, or speaker diarization.

## Current Architecture To Preserve

Read `docs/NEXT_THREAD_HANDOFF.md` first.

Relevant files:

- `src/types/topic.ts`
  - shared types for Focus, analyzed segments, decision logs, graph nodes
- `src/utils/topicRules.ts`
  - initial topic nodes and topic scoring
- `src/utils/focusGate.ts`
  - Focus relation / update decision rules
- `src/hooks/useTopicEngine.ts`
  - main state engine and segment processing
- `src/components/TopicInspector.tsx`
  - right panel, current analysis, Decision Log
- `src/utils/*.test.ts`
  - behavior tests

Avoid large rewrites. Prefer extending the current flow:

```txt
processSegment
-> topic scoring
-> reference resolution
-> intent detection
-> Focus Gate
-> state updates
-> inspector display
```

## Non-Goals

- No semantic embeddings or remote AI calls.
  - Update (2026-07): local LLM calls via an OpenAI-compatible server (LM Studio) are now allowed, but only in the post-meeting report layer (`llmGapReview.ts`). The realtime segment pipeline stays rule-based.
- No persistent storage.
- No meeting-minutes features.
- No automatic creation of many new nodes from weak matches.
- No Focus auto-change based only on a higher topic score.

## Type Changes

Add `locked` to `FocusState`.

```ts
export type FocusState = {
  focusTopicId: string | null;
  focusLabel: string | null;
  focusSetBy: "auto" | "manual";
  locked: boolean;
  startedAt: number;
  goal?: string;
};
```

Initialize and reset with `locked: false`.

Add utterance intent.

```ts
export type UtteranceIntent =
  | "question"
  | "concern"
  | "todo"
  | "decision"
  | "agreement"
  | "correction"
  | "switch_topic"
  | "unknown";
```

Add normalized terms to topic node data.

```ts
export type TopicNodeData = {
  label: string;
  heat: number;
  keywords: string[];
  normalizedTerms: string[];
  lastTouchedAt: number | null;
  evidence: string[];
};
```

Add score breakdown.

```ts
export type TopicScoreBreakdown = {
  topicId: string;
  label: string;
  total: number;
  keywordScore: number;
  synonymScore: number;
  focusContextScore: number;
  intentScore: number;
  recencyScore: number;
  matchedKeywords: string[];
  matchedSynonyms: string[];
  reason: string;
};
```

Update `TopicDecisionLog.topicScores` to use `TopicScoreBreakdown[]`.

Update `AnalyzedSegment.analysis` to include:

```ts
intent: UtteranceIntent;
topicScores: TopicScoreBreakdown[];
```

If useful, extend `FocusGateResult` with explicit Focus update fields:

```ts
shouldChangeFocus: boolean;
focusChangeCandidateTopicId: string | null;
```

The state engine should only change `focusState.focusTopicId` when `shouldChangeFocus === true`.

## Intent Detection

Implement deterministic rule-based intent detection in `src/utils/focusGate.ts` or a small new utility such as `src/utils/intentRules.ts`.

Suggested rule priority:

1. `switch_topic`
   - examples: `話を戻すと`, `戻ると`, `別件`, `次に`, `話を変える`, `切り替える`
2. `correction`
   - examples: `いや違う`, `違います`, `そうではなく`, `訂正`, `修正`
3. `todo`
   - examples: `後で見る`, `あとで見る`, `確認する`, `やります`, `対応`, `TODO`, `ToDo`
4. `decision`
   - examples: `決めます`, `決める`, `決定`, `方針`, `結論`
5. `concern`
   - examples: `問題`, `懸念`, `リスク`, `不安`, `困る`, `難しい`, `まずい`
6. `question`
   - examples: `どうしますか`, `ですか`, `ますか`, `なぜ`, `どこ`, `いつ`, `？`, `?`
7. `agreement`
   - examples: `そうですね`, `はい`, `なるほど`, `了解`, `うん`
8. `unknown`

One utterance gets one primary intent. Keep this simple and testable.

Map intents to existing `ImportantMention["type"]` where needed:

- `question` -> `question`
- `concern` -> `problem` or `risk`; choose one consistently and document in code
- `todo` -> `todo`
- `decision` -> `decision`
- `agreement`, `correction`, `switch_topic`, `unknown` -> no important mention unless another rule explicitly requires it

## Normalized Terms

Keep `keywords` as exact product/domain terms.
Add `normalizedTerms` as synonym-like terms that should contribute to scoring but be displayed separately.

Minimum required additions:

```txt
速度:
待ち時間, 反応, もたつき, ラグ, 重い, 遅れる

コスト:
料金, API代, 高い, 安い, 使用量, 課金

精度:
正確さ, 誤検知, 間違える, ずれる, 認識ミス
```

It is OK if some existing `keywords` overlap with normalized terms, but avoid double-counting the same matched string in both `keywordScore` and `synonymScore`.

## Topic Score Breakdown

Replace the current count-only `scoreTopic()` usage with a breakdown-producing function.

Suggested API in `src/utils/topicRules.ts`:

```ts
export function scoreTopicBreakdown(input: {
  text: string;
  node: TopicGraphNode;
  focusState: FocusState;
  intent: UtteranceIntent;
  now: number;
}): TopicScoreBreakdown
```

Suggested scoring:

- `keywordScore`: `matchedKeywords.length * 1.0`
- `synonymScore`: `matchedSynonyms.length * 0.7`
- `focusContextScore`:
  - `0.5` when the node is current Focus
  - `0` otherwise
  - only apply if there is at least one keyword or synonym match, so Focus alone does not win unrelated utterances
- `intentScore`:
  - `0.3` for `question`, `concern`, `todo`, or `decision` when the node has any keyword/synonym match
  - `0.4` for `switch_topic` when the node has any keyword/synonym match and is not current Focus
  - `0` otherwise
- `recencyScore`:
  - `0.2` when `lastTouchedAt` is within the last 60 seconds and the node has any keyword/synonym match
  - `0` otherwise

`total = keywordScore + synonymScore + focusContextScore + intentScore + recencyScore`.
Round display values to 2 decimal places, but keep calculations straightforward.

Filter candidate topics with `total > 0`.
Sort by:

1. higher `total`
2. higher `keywordScore`
3. higher `synonymScore`
4. original node order

`reason` should be short but specific, for example:

```txt
keyword: レイテンシー / synonym: ラグ / intent: concern / focus context
```

## Focus Auto-Change Rules

This is the most important stability requirement.

Focus is the conversation's center of gravity, not simply the latest highest-scoring topic.
Do not change Focus just because another topic scored higher.

### Allowed To Set Focus

Focus may be set automatically only when all conditions are true:

- `focusState.focusTopicId === null`
- selected topic exists
- selected topic has a positive `keywordScore` or `synonymScore`
- intent is not `agreement`

Result:

- set Focus to selected topic
- `focusSetBy: "auto"`
- preserve `locked: false`

### Allowed To Auto-Change Existing Focus

Existing Focus may change automatically only when all conditions are true:

- `focusState.locked === false`
- current Focus exists
- selected topic exists
- selected topic is not current Focus
- intent is `switch_topic`
- selected topic has a strong direct match:
  - `keywordScore >= 1`, or
  - `synonymScore >= 0.7`
- selected topic total is clearly stronger than the current Focus score:
  - `selected.total >= currentFocus.total + 0.7`
- utterance is not classified as `agreement`
- there are no unresolved references

Result:

- change Focus to selected topic
- `focusSetBy: "auto"`
- update `startedAt`
- log/display reason as an intentional topic switch

### Never Auto-Change Focus

Focus must not change automatically when any condition is true:

- `focusState.locked === true`
- intent is `agreement`
- utterance only has weak recency/focus-context score
- selected topic is off-focus important without `switch_topic`
- selected topic is only adjacent to Focus
- the utterance has unresolved references
- the utterance is short noise

Required example:

```txt
Focus: 速度, locked: true
Utterance: コストも高いですね
Expected: Focus remains 速度. Cost can appear in score breakdown and important/related records, but does not steal Focus.
```

## Focus Gate Behavior With Intent

Update `evaluateFocusGate` to accept `intent` and `topicScores`.

Expected behavior:

- `agreement`
  - if it refers to Focus or has no strong topic match: `off_topic_noise` or keep `on_focus`
  - never changes Focus
- `concern` / `todo` / `decision` / `question`
  - on Focus match: `on_focus`
  - off Focus direct match: `off_topic_important`
  - should not change Focus unless `switch_topic` rules are also satisfied; with one-primary-intent detection this means they normally do not change Focus
- `switch_topic`
  - when unlocked and auto-change conditions pass: `on_focus` with `shouldChangeFocus: true`
  - when locked: do not change Focus; classify as `off_topic_important` or `adjacent` depending on relation
- `correction`
  - if matched/resolved to Focus: `on_focus`
  - otherwise `uncertain` unless it has a direct off-focus topic match worth recording

Keep existing relations:

- `on_focus`
- `adjacent`
- `off_topic_important`
- `off_topic_noise`
- `uncertain`

## Manual Focus UI

Add controls to the right panel (`TopicInspector`) or a small child component used by it.

Required controls:

- topic select using topic labels
- clear Focus button or select option
- `focusをロック` checkbox

Required behavior:

- selecting a topic sets:
  - `focusTopicId`
  - `focusLabel`
  - `focusSetBy: "manual"`
  - `startedAt: Date.now()`
  - preserve current `locked` value
- clearing Focus sets:
  - `focusTopicId: null`
  - `focusLabel: null`
  - `focusSetBy: "manual"`
  - preserve current `locked` value
- toggling lock only changes `locked`
- locked state must be visible near the current Focus display

Expose callbacks from `useTopicEngine`, for example:

```ts
setManualFocus(topicId: string | null): void
setFocusLocked(locked: boolean): void
```

Pass them from `App.tsx` to `TopicInspector`.

## Decision Log Display

In `TopicInspector`, show score breakdown for the latest decision.

Required fields:

- `total`
- `keywordScore`
- `synonymScore`
- `intentScore`
- `focusContextScore`
- `recencyScore`
- `matchedKeywords`
- `matchedSynonyms`
- `reason`

Do not show only `label:score`; the point is explainability.
It is fine to show only the top 3 topic scores to keep the panel readable.

Also include `intent` in the current analysis panel and session JSON.

## Tests

Update existing tests and add focused tests.

Required unit tests:

1. `topicRules`
   - `待ち時間`, `ラグ`, `重い` produce a positive synonym score for `速度`
   - score breakdown includes matched synonyms separately from matched keywords
   - sorting chooses the higher total, with deterministic tie behavior

2. `intentRules` or `focusGate`
   - `どうしますか` -> `question`
   - `問題になりそう` -> `concern`
   - `後で見る` -> `todo`
   - `決めます` -> `decision`
   - `そうですね` -> `agreement`
   - `いや違う` -> `correction`
   - `話を戻すと` -> `switch_topic`

3. `focusGate`
   - locked Focus does not change when cost is mentioned
   - unlocked Focus can change only with `switch_topic` and strong direct match
   - agreement does not change Focus
   - off-focus `concern` / `todo` becomes `off_topic_important`

4. state-level behavior if practical
   - manual Focus selection sets `focusSetBy: "manual"`
   - lock toggle prevents automatic Focus changes

Run:

```sh
npm run typecheck
npm test
npm run build
```

## Completion Criteria

- User can manually select and clear Focus.
- User can lock Focus.
- While locked, mentioning `コスト` or `料金` does not steal Focus from `速度`.
- `待ち時間`, `ラグ`, and `重い` can classify toward `速度` through synonym scoring.
- Decision Log shows score breakdown, not only keyword count.
- Current analysis shows utterance intent.
- Focus auto-change conditions are encoded in tests.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
