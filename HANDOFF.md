# Handoff: Live Topic Graph

## Objective

This workspace contains a local prototype for detecting the current conversation topic from live Japanese speech and highlighting topic nodes in a React Flow graph.

The current version is no longer only keyword-count based. It includes manual Focus control, Focus lock, rule-based intent classification, synonym scoring, and Decision Log score breakdowns.

For the full current handoff, read:

```txt
docs/NEXT_THREAD_HANDOFF.md
```

## Stack

- TypeScript
- React
- Vite
- Node.js
- WebSocket (`ws`)
- React Flow (`@xyflow/react`)
- Browser Web Speech API for STT

No OpenAI API, Deepgram, Whisper, Python, database, auth, TTS, or speaker diarization is used.

## Run

```sh
npm install
npm run dev
```

Expected app URL:

```txt
http://127.0.0.1:5173/
```

Expected WebSocket URL:

```txt
ws://127.0.0.1:8787
```

If stale localhost processes are occupying ports:

```sh
scripts/kill-localhost-port.sh 5173 5174 8787
```

## Validate

```sh
npm run typecheck
npm test
npm run build
```

Latest verified results:

- `npm run typecheck`: passed
- `npm test`: passed, 4 files / 16 tests
- `npm run build`: passed

## Implemented

- Microphone start/stop.
- Japanese Web Speech API transcription with interim and final text display.
- 5-second segmentation of finalized speech chunks.
- Manual text mode and replay JSON scenario mode.
- React Flow topic graph with heat and active highlighting.
- Manual Focus select and clear.
- Focus lock.
- Rule-based utterance intent classification.
- Keyword and normalized-term / synonym scoring.
- Focus Gate with explicit `shouldChangeFocus` decision.
- Decision Log with score breakdown.
- Important off-focus mention capture.
- Pronoun/reference phrase detection and context-based reference candidates.
- Lightweight local WebSocket relay for session log events.
- Utility script to kill stale localhost dev servers by port.

## Key Files

- `docs/NEXT_THREAD_HANDOFF.md` - detailed current handoff
- `src/hooks/useTopicEngine.ts` - main state engine
- `src/types/topic.ts` - shared topic/focus/decision types
- `src/utils/topicRules.ts` - topic scoring and normalized terms
- `src/utils/intentRules.ts` - intent detection
- `src/utils/focusGate.ts` - Focus relation and Focus-change rules
- `src/components/TopicInspector.tsx` - right-panel Focus controls and Decision Log
- `scripts/kill-localhost-port.sh` - port cleanup helper

## Current Limitations

- Detection is deterministic and rule-based.
- Reference detection can still double-match overlapping phrases.
- Graph adjacency is partly hard-coded.
- State is in memory only and resets on refresh.
- There are utility tests, but no full engine/replay fixture tests yet.
