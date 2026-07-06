# attension_mindmap - Next Thread Handoff

Last updated: 2026-07-06

## Current State

attension_mindmap is a Vite + React + TypeScript prototype for testing live Japanese meeting-topic extraction without external AI services.

The current version is no longer built around fixed seed topics. It now includes:

- meeting-specific `MeetingGraph`
- transcript-derived topic nodes with aliases
- rule-based topic coverage tracking
- automatic topic closure after focus shift + quiet window
- synthetic gap nodes and meeting-wide gap summary
- meeting-first dashboard UI
- manual Focus selection
- Focus lock
- rule-based utterance intent classification
- overlap-based topic matching
- per-topic score breakdown in the dev drawer

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
npm run lint
npm run typecheck
npm test
npm run build
```

Latest results:

- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm test`: passed, 4 files / 13 tests
- `npm run build`: passed

Dev server note:

- A previous temporary dev server was started on `http://127.0.0.1:5174/` because `5173` was occupied.
- It has since been stopped.
- Final port check showed no listeners on `5173`, `5174`, or `8787`.

## Important Files

- `src/hooks/useTopicEngine.ts`
  - Main state engine.
  - Processes speech/manual/replay text into analyzed segments.
  - Runs topic extraction, topic matching, coverage updates, closure checks, gap generation, graph projection, decision logs, and important mentions.
  - Exposes `setManualFocus(topicId)` and `setFocusLocked(locked)`.

- `src/types/topic.ts`
  - Core types.
  - Important current types:
    - `MeetingGraph`
    - `TopicNode`
    - `TopicGap`
    - `FocusState`
    - `UtteranceIntent`
    - `TopicMatchCandidate`
    - `TopicDecisionLog`
    - `AnalyzedSegment`
    - `ImportantMention`

- `src/utils/topicRules.ts`
  - Meeting graph bootstrap.
  - Transcript clause splitting.
  - Topic phrase extraction.
  - Topic overlap scoring.
  - Coverage detection.
  - Gap generation.
  - Meeting graph to React Flow projection.

- `src/utils/intentRules.ts`
  - Rule-based utterance intent classification.
  - Maps intents to `ImportantMention` types where applicable.

- `src/utils/topicEngine.ts`
  - Creates and mutates the `MeetingGraph`.
  - Chooses stable topics or creates new ones from phrases.
  - Applies coverage updates per segment.
  - Closes dormant topics and emits gap records.

- `src/components/TopicInspector.tsx`
  - Right rail + dev drawer.
  - Displays current topic, local coverage checklist, current topic gaps, meeting-wide gap list, manual Focus controls, latest analysis, score breakdown, and raw JSON.

- `src/components/TopicGraph.tsx`
  - Renders meeting root, real topic nodes, and synthetic missing nodes with state badges.

- `.github/workflows/ci.yml`
  - Runs `lint`, `typecheck`, `test`, and `build`.

- `.github/workflows/cloudflare-pages.yml`
  - Deploys `dist/` to Cloudflare Pages on `main`.

- `scripts/kill-localhost-port.sh`
  - Utility script for killing stale localhost dev servers by port.

## Current Processing Flow

```txt
speech final text / manual text / replay item
-> processSegment(text, source)
-> detect utterance intent
-> extract topic phrases from clauses
-> match phrase against existing topic title + aliases
-> create topic when no stable overlap exists
-> update topic coverage
-> close dormant topics after focus shift + quiet window
-> compute local gaps + meeting-wide gap summary
-> project MeetingGraph into React Flow nodes/edges
-> render dashboard and dev drawer
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

- The right rail dev drawer has a topic select for manual Focus.
- Selecting a topic sets `focusSetBy: "manual"` and updates `startedAt`.
- Selecting `Focusなし` clears Focus but preserves lock state.
- `focusをロック` toggles only `locked`.
- When locked, automatic Focus changes are blocked.

## Topic Model

The central domain model is now:

```ts
type MeetingGraph = {
  meetingId: string;
  title: string;
  rootTopicId: string;
  nodes: TopicNode[];
  edges: TopicEdge[];
  gaps: TopicGap[];
  gapSummary: MeetingGapSummary;
};
```

Important `TopicNode` fields:

- `lifecycle: "active" | "discussed" | "decided" | "unresolved"`
- `displayStates`
- `coverage`
- `aliases`
- `mentionCount`
- `firstSeenAt`
- `lastSeenAt`
- `lastActivatedAt`
- `closedAt`

Important `TopicEdge.type` values:

- `parent`
- `related`
- `depends_on`
- `contradicts`
- `follow_up`
- `missing_of`

There is one meeting root node. Top-level extracted topics attach to it.

## Topic Extraction

The analyzer stays fully local and deterministic.

Current extraction approach:

- normalize transcript text
- split into clauses
- extract topic phrases via markers such as:
  - `について`
  - `の件`
  - `を決める`
  - `が問題`
  - `したい`
- fallback to repeated content phrases
- avoid short acknowledgements and pronoun-only phrases
- match against existing topic `title + aliases`
- create a new topic only when overlap is below threshold

This logic lives in `src/utils/topicRules.ts`.

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

## Coverage And Gaps

Coverage updates run on every analyzed segment.

Tracked coverage fields:

- `decision`
- `reason`
- `owner`
- `dueDate`
- `risk`
- `alternative`
- `objection`
- `nextAction`
- `dependency`
- `openQuestionResolved`

Topic closure rule:

- focus moved away from the topic, and
- the topic is not reactivated for the next 2 segments or 15 seconds

Gap generation currently includes:

- `shallow`
- `missing_decision`
- `missing_reason`
- `missing_owner`
- `missing_due_date`
- `missing_next_action`
- `missing_risk`
- `missing_alternative`
- `unresolved`

Each active gap also appears in the graph as a synthetic child node with edge type `missing_of`.

## UI Layout

Current layout:

- header: meeting title, elapsed time, current topic, websocket status
- center: React Flow topic map
- right rail: current topic card, coverage checklist, current topic gaps, meeting gaps
- bottom utility area: mic controls, manual replay, transcript replay, recent transcript
- dev drawer: latest analysis, score breakdown, important mentions, raw JSON, focus controls

## Cloudflare Cache Follow-Up

Cloudflare Pages deployment workflow exists, and static cache headers are now committed.

Committed content:

```txt
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*
  Cache-Control: public, max-age=0, must-revalidate
```

- Why:

- hashed Vite assets under `/assets/` should be cached aggressively by Cloudflare Cache
- HTML should revalidate so fresh deployments are visible immediately

This is the intended Cloudflare Cache implementation. Do not confuse it with GitHub Actions dependency caching.

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
