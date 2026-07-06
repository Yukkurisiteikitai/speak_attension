# Live Topic Graph - Next Thread Handoff

Last updated: 2026-07-03

## Current State

Live Topic Graph is a Vite + React + TypeScript prototype for testing live Japanese topic detection without external AI services.

The current version has moved beyond simple keyword count. It now includes:

- manual Focus selection
- Focus lock
- rule-based utterance intent classification
- keyword + normalized-term / synonym scoring
- per-topic score breakdown in Decision Log
- explicit Focus auto-change gates to prevent accidental Focus stealing

No OpenAI, Deepgram, Whisper, Python, database, auth, TTS, speaker diarization, or remote AI service is used.

## How To Run

```sh
npm install
npm run dev
```

Expected URLs:

```txt
App: http://127.0.0.1:5173/
WebSocket: ws://127.0.0.1:8787
```

If stale local servers are occupying the ports:

```sh
scripts/kill-localhost-port.sh 5173 5174 8787
```

The script finds LISTENing TCP processes for the given ports with `lsof`, sends `TERM`, waits briefly, then sends `KILL` only if they remain.

## Validation

Latest verified commands:

```sh
npm run typecheck
npm test
npm run build
```

Latest results:

- `npm run typecheck`: passed
- `npm test`: passed, 4 files / 16 tests
- `npm run build`: passed

Dev server note:

- A previous temporary dev server was started on `http://127.0.0.1:5174/` because `5173` was occupied.
- It has since been stopped.
- Final port check showed no listeners on `5173`, `5174`, or `8787`.

## Important Files

- `src/hooks/useTopicEngine.ts`
  - Main state engine.
  - Processes speech/manual/replay text into analyzed segments.
  - Runs intent detection, topic scoring, reference resolution, Focus Gate, graph updates, decision logs, and important mentions.
  - Exposes `setManualFocus(topicId)` and `setFocusLocked(locked)`.

- `src/types/topic.ts`
  - Core types.
  - Important current types:
    - `FocusState`
    - `UtteranceIntent`
    - `TopicScoreBreakdown`
    - `TopicDecisionLog`
    - `AnalyzedSegment`
    - `ImportantMention`

- `src/utils/topicRules.ts`
  - Initial topic nodes.
  - Keyword matching.
  - Normalized-term / synonym matching.
  - Score breakdown generation via `scoreTopicBreakdown`.
  - Score sorting via `sortTopicScores`.

- `src/utils/intentRules.ts`
  - Rule-based utterance intent classification.
  - Maps intents to `ImportantMention` types where applicable.

- `src/utils/focusGate.ts`
  - Classifies utterances as:
    - `on_focus`
    - `adjacent`
    - `off_topic_important`
    - `off_topic_noise`
    - `uncertain`
  - Also returns:
    - `shouldChangeFocus`
    - `focusChangeCandidateTopicId`

- `src/utils/contextResolver.ts`
  - Detects reference phrases like `これ`, `それ`, `さっきの話`, `前のやつ`, `だから`.
  - Resolves candidate topics from active topic and recent segments.

- `src/components/TopicInspector.tsx`
  - Right panel.
  - Displays current Focus, lock state, manual Focus select, current analysis, Decision Log score breakdown, related utterances, important notes, unresolved references, and session JSON.

- `scripts/kill-localhost-port.sh`
  - Utility script for killing stale localhost dev servers by port.

## Current Processing Flow

```txt
speech final text / manual text / replay item
-> processSegment(text, source)
-> detect utterance intent
-> resolve reference phrases
-> score every topic with keyword/synonym/focus/intent/recency breakdown
-> sort candidate topics
-> Focus Gate classification and Focus-change decision
-> conditionally update Focus/current topic/graph heat/important mentions
-> render graph and inspector
```

Speech source behavior:

- Web Speech API interim text is displayed only.
- Final speech chunks are buffered.
- Every 5 seconds, the speech buffer is flushed as one segment with `source: "speech"`.

Manual/replay behavior:

- Manual text is processed immediately as `source: "manual"`.
- Replay items are processed immediately as `source: "replay"`.

## Focus State

Current type:

```ts
type FocusState = {
  focusTopicId: string | null;
  focusLabel: string | null;
  focusSetBy: "auto" | "manual";
  locked: boolean;
  startedAt: number;
  goal?: string;
};
```

UI behavior:

- The right panel has a topic select for manual Focus.
- Selecting a topic sets `focusSetBy: "manual"` and updates `startedAt`.
- Selecting `Focusなし` clears Focus but preserves lock state.
- `focusをロック` toggles only `locked`.
- When locked, automatic Focus changes are blocked.

## Focus Auto-Change Rules

Focus is treated as the conversation center, not simply the latest highest-scoring topic.

Focus may be automatically set when:

- no Focus exists
- Focus is not locked
- selected topic exists
- selected topic has direct keyword or synonym score
- intent is not `agreement`

Existing Focus may automatically change only when:

- Focus is not locked
- current Focus exists
- selected topic exists and is not current Focus
- intent is `switch_topic`
- selected topic has a strong direct match:
  - `keywordScore >= 1`, or
  - `synonymScore >= 0.7`
- selected total is at least `currentFocus.total + 0.7`
- there are no unresolved references

Focus never auto-changes for:

- `locked === true`
- `agreement`
- unresolved references
- adjacent-only topics
- off-focus important utterances without `switch_topic`
- weak recency/focus-context-only scores
- short noise

Required behavior now covered by tests:

- If Focus is `速度` and locked, `コストも高いですね` does not steal Focus.
- Unlocked Focus can change on explicit `switch_topic` with strong direct match.
- Agreement does not change Focus.
- Off-focus concern/todo-style utterances become important notes instead of stealing Focus.

## Intent Rules

`src/utils/intentRules.ts` assigns one primary intent per utterance.

Current intents:

- `question`
- `concern`
- `todo`
- `decision`
- `agreement`
- `correction`
- `switch_topic`
- `unknown`

Priority order:

1. `switch_topic`
2. `correction`
3. `todo`
4. `decision`
5. `concern`
6. `question`
7. `agreement`
8. `unknown`

Examples covered by tests:

- `どうしますか` -> `question`
- `問題になりそう` -> `concern`
- `後で見る` -> `todo`
- `決めます` -> `decision`
- `そうですね` -> `agreement`
- `いや違う` -> `correction`
- `話を戻すと` -> `switch_topic`

## Topic Scoring

`TopicNodeData` now includes:

```ts
normalizedTerms: string[];
```

`TopicScoreBreakdown` includes:

- `total`
- `keywordScore`
- `synonymScore`
- `focusContextScore`
- `intentScore`
- `recencyScore`
- `matchedKeywords`
- `matchedSynonyms`
- `reason`

Current scoring:

- keyword: `matchedKeywords.length * 1.0`
- synonym: `matchedSynonyms.length * 0.7`
- focus context: `0.5` only when the topic is current Focus and has a direct match
- intent: `0.3` for question/concern/todo/decision with direct match
- switch-topic intent: `0.4` for non-Focus direct match
- recency: `0.2` if the topic was touched within 60 seconds and has direct match

Sorting:

1. higher `total`
2. higher `keywordScore`
3. higher `synonymScore`
4. original node order

Minimum normalized terms added:

- `速度`: `待ち時間`, `反応`, `もたつき`, `ラグ`, `重い`, `遅れる`
- `コスト`: `API代`, `使用量`, `課金`
- `精度`: `正確さ`, `間違える`, `ずれる`, `認識ミス`

Note: some cost/accuracy terms such as `料金`, `高い`, `安い`, `誤検知` already existed as keywords, so they were not duplicated as normalized terms.

## Decision Log

The right panel now shows score breakdown for the latest decision.

Displayed fields:

- selected topic
- matched keywords
- matched synonyms
- intent
- top 3 topic score cards
- per-card total, keyword, synonym, intent, focus, recency, matched terms, reason

Session JSON also includes intent and score breakdown data.

## Tests

Current test files:

- `src/utils/topicRules.test.ts`
- `src/utils/intentRules.test.ts`
- `src/utils/focusGate.test.ts`
- `src/utils/contextResolver.test.ts`

Current coverage includes:

- existing keyword score compatibility
- synonym score for latency terms such as `待ち時間`, `ラグ`, `重い`
- score breakdown and deterministic sorting
- intent classification examples
- locked Focus behavior
- switch-topic auto Focus change
- agreement/noise behavior
- off-focus important behavior

## Known Limitations

- The engine is still rule-based and intentionally simple.
- `contextResolver` can still double-match overlapping phrases, for example `それで` and `それ`.
- Graph adjacency is partly hard-coded in `SEMANTIC_ADJACENCY`.
- Unknown node creation is conservative after Focus Gate.
- Off-topic important utterances are recorded as notes instead of creating nodes.
- Web Speech API support depends on browser; Chrome-like browsers are best.
- State is in memory only and resets on refresh.
- Fixture-level replay tests now cover fixed focus and intent scenarios.

## Recommended Next Work

1. Add state-level tests for `useTopicEngine`.
   - Manual Focus selection sets `focusSetBy: "manual"`.
   - Lock toggle blocks auto Focus changes through the full engine path.

2. Improve reference phrase detection.
   - Avoid overlapping matches such as `それで` plus `それ`.
   - Store span offsets if future UI highlights reference phrases in text.

3. Tune importance handling.
   - Consider separate confidence for important mention severity instead of reusing focus alignment.
   - Improve mapping of `concern` to `problem` vs `risk`.

5. Improve right-panel ergonomics.
   - The score breakdown is intentionally explicit now, but may need denser layout after more topics are added.

6. Add export/import for session logs.
   - Keep it local JSON only for now.
   - No database is needed.

## Notes For Next Agent

- Preserve the prototype constraint: do not add OpenAI, Deepgram, Whisper, Python, DB, auth, TTS, or speaker diarization unless the user explicitly changes direction.
- The app favors topic labels in UI, but internal JSON may include ids for debugging.
- There may be unrelated dirty changes from earlier work; do not revert user changes.
- If `npm run dev` fails because ports are occupied, run `scripts/kill-localhost-port.sh 5173 5174 8787` and retry.
