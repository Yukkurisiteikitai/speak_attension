# Live Topic Graph - Next Thread Handoff

## Current State

Live Topic Graph is now a Vite + React + TypeScript prototype for testing live topic detection without external AI services.

Implemented stack:

- React + TypeScript + Vite
- React Flow via `@xyflow/react`
- Browser Web Speech API for Japanese STT
- Manual text input mode
- Replay JSON scenario mode
- Lightweight Node.js WebSocket relay in `server/index.ts`
- Vitest tests for topic rules, context resolver, and Focus Gate

No OpenAI, Deepgram, Whisper, Python, database, auth, TTS, or speaker diarization is used.

## How To Run

```sh
npm install
npm run dev
```

App URL:

```txt
http://127.0.0.1:5173/
```

WebSocket server:

```txt
ws://127.0.0.1:8787
```

Validation commands:

```sh
npm run typecheck
npm test
npm run build
```

Last verified results:

- `npm run typecheck`: passed
- `npm test`: passed, 3 files / 9 tests
- `npm run build`: passed
- `curl -I http://127.0.0.1:5173/`: `200 OK`

## Important Files

- `src/hooks/useTopicEngine.ts`
  - Main state engine.
  - Processes speech/manual/replay text into analyzed segments.
  - Updates graph heat, current topic, focus state, decision logs, and important mentions.

- `src/types/topic.ts`
  - Core types:
    - `TopicNodeData`
    - `TranscriptSegment`
    - `AnalyzedSegment`
    - `FocusState`
    - `FocusRelation`
    - `TopicDecisionLog`
    - `ResolvedReference`
    - `ImportantMention`

- `src/utils/topicRules.ts`
  - Initial topic nodes and keyword matching.
  - Initial nodes include ASR, topic detection, graph, UI, model, cost, latency/speed, accuracy.

- `src/utils/contextResolver.ts`
  - Detects reference phrases like `これ`, `それ`, `さっきの話`, `前のやつ`, `だから`.
  - Resolves candidate topic from active topic and recent segments.

- `src/utils/focusGate.ts`
  - Classifies each utterance as:
    - `on_focus`
    - `adjacent`
    - `off_topic_important`
    - `off_topic_noise`
    - `uncertain`

- `src/components/ManualReplayPanel.tsx`
  - Manual text mode and replay JSON scenario UI.

- `src/components/TopicInspector.tsx`
  - Right panel.
  - Displays focus topic, current analyzed utterance, decision log, related utterances, important notes, unresolved references, and JSON log.

## Current Processing Flow

```txt
speech final text / manual text / replay item
-> processSegment(text, source)
-> keyword topic scoring
-> reference phrase detection and context resolution
-> Focus Gate classification
-> create AnalyzedSegment
-> conditionally update graph/current topic/important mentions
-> render inspector and graph
```

Speech source behavior:

- Web Speech API interim text is displayed only.
- Final speech chunks are buffered.
- Every 5 seconds, the speech buffer is flushed as one segment with `source: "speech"`.

Manual/replay behavior:

- Manual text is processed immediately as `source: "manual"`.
- Replay items are processed immediately as `source: "replay"`.

## Focus Gate Behavior

The current focus is stored as:

```ts
type FocusState = {
  focusTopicId: string | null;
  focusLabel: string | null;
  focusSetBy: "auto" | "manual";
  startedAt: number;
  goal?: string;
};
```

Current behavior:

- First detected topic becomes the focus automatically.
- Focus is currently not manually editable from the UI.
- UI displays topic labels such as `速度`, not internal ids such as `latency`.

Classification rules:

- `on_focus`
  - selected/matched topic is focus, or resolved reference points to focus.
  - Updates graph heat and current topic.

- `adjacent`
  - selected topic is related to focus by graph edge or semantic adjacency.
  - Lightly updates graph heat.
  - Does not steal current topic.

- `off_topic_important`
  - focus外 but contains important language such as problem/risk/TODO/decision/question.
  - Adds `ImportantMention`.
  - Does not update current topic.

- `off_topic_noise`
  - short acknowledgment such as `そうですね`, `はい`, `なるほど`.
  - Logs only.

- `uncertain`
  - unresolved reference or weak relation.
  - Logs unresolved reference.
  - Does not update current topic.

## Replay Scenario

`ManualReplayPanel` currently ships with this Focus Gate test scenario:

```json
[
  { "text": "今日はレイテンシー対策を決めます" },
  { "text": "それで、さっきの話に戻ると遅延が問題です" },
  { "text": "UIのLive感にも関係します" },
  { "text": "ただ、コストも後で見た方がいいです" },
  { "text": "そうですね" }
]
```

Expected:

- 1: `on_focus`
- 2: `on_focus`
- 3: `adjacent`
- 4: `off_topic_important`
- 5: `off_topic_noise`

This expectation is covered in `src/utils/focusGate.test.ts`.

## Known Limitations

- Focus is auto-set only. There is no UI yet to manually pin/change focus.
- Focus Gate is rule-based and intentionally simple.
- Reference detection can double-match phrases, for example `それで` and `それ`.
- Graph adjacency is partly hard-coded in `SEMANTIC_ADJACENCY`.
- `ImportantMention` detection is keyword-based.
- Unknown node creation is conservative after Focus Gate; off-topic important utterances are recorded as notes instead of creating nodes.
- Web Speech API support depends on browser; Chrome-like browsers are best.
- State is in memory only and resets on refresh.

## Recommended Next Work

1. Add manual focus controls.
   - Let the user pin focus by selecting a graph node.
   - Set `focusSetBy: "manual"`.
   - Add a clear focus/reset focus action.

2. Improve reference phrase detection.
   - Avoid overlapping matches such as `それで` plus `それ`.
   - Store span offsets if future UI highlights reference phrases in text.

3. Make Focus Gate more inspectable.
   - Show the exact rule that fired.
   - Show why current topic did or did not update.

4. Add fixture-level replay tests.
   - Move the default scenario into a test fixture.
   - Test full analysis results, not only `evaluateFocusGate`.

5. Add important mention tuning.
   - Improve priority and classification of `problem`, `risk`, `todo`, `decision`, `question`.
   - Consider separate confidence from focus alignment.

6. Add export/import for session logs.
   - Keep it local JSON only for now.
   - No database is needed yet.

## Notes For Next Agent

- There are existing dirty changes from this work and prior work. Do not revert unrelated deletions in `some_designs/*`.
- The app currently favors labels in UI, but internal JSON may still include ids inside nested analysis structures when useful for state debugging.
- Preserve the prototype constraint: do not add OpenAI, Deepgram, Whisper, Python, DB, auth, or TTS unless the user explicitly changes direction.
