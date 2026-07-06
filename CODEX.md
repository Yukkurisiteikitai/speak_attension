# Codex Instructions

## Start Here

Before making changes in this repository, read:

- `docs/NEXT_THREAD_HANDOFF.md`

That file is the detailed source of truth for the Live Topic Graph prototype.

Use this file as the short entrypoint:

- current state summary
- required validation commands
- files to inspect first
- current implementation direction

## Project Summary

Live Topic Graph is a local prototype for testing live topic detection from conversation.

Current capabilities:

- Japanese Web Speech API transcription
- Manual text input
- Replay JSON scenarios
- React Flow topic graph
- Keyword-based topic detection
- Pronoun/reference detection
- Focus Gate classification
- Important off-focus mention capture
- Manual Focus selection
- Focus lock
- Decision Log score breakdown
- Fixed replay fixture tests for Topic Engine behavior

Do not add external AI/STT services unless the user explicitly changes direction.

Avoid:

- OpenAI API
- Deepgram
- Whisper
- Python
- Database persistence
- Auth/login
- TTS
- Speaker diarization

## Development Commands

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

App URL:

```txt
http://127.0.0.1:5173/
```

## Working Notes

- Keep the prototype lightweight and local-first.
- Preserve TypeScript strictness.
- Prefer changing the rule-based engine and tests before adding new UI complexity.
- When touching topic/focus behavior, update or add tests under `src/utils/*.test.ts`.
- When changing topic/focus logic, check whether replay fixtures also need updates.
- UI should show topic labels such as `速度`, not internal ids such as `latency`, unless debugging state explicitly requires ids.
- Existing deleted files under `some_designs/*` are unrelated dirty work; do not restore or revert them unless explicitly asked.

## Current Status

The app is in a Focus stabilization phase.

What is already in place:

- manual Focus selection
- Focus lock
- right panel current analysis display
- Decision Log score breakdown
- rule-based intent detection
- synonym scoring
- fixed replay evaluation set

Current interpretation:

- topic detection is still shallow and mostly rule-based
- Focus stealing has been reduced
- the next work is not adding new product features first
- the next work is improving detection quality against fixed replay cases

## Files To Read First

- `docs/NEXT_THREAD_HANDOFF.md`
- `src/utils/topicEngine.ts`
- `src/utils/replay-fixtures.ts`
- `src/utils/replay-fixtures.test.ts`
- `src/hooks/useTopicEngine.ts`
- `src/utils/focusGate.ts`
- `src/utils/intentRules.ts`
- `src/utils/topicRules.ts`

## Replay Evaluation

The fixed replay evaluation set now exists.

Main files:

- `src/utils/replay-fixtures.ts`
- `src/utils/replay-fixtures.test.ts`

Each replay segment carries:

- `expectedTopicId`
- `expectedIntent`
- `expectedFocusRelation`
- `shouldChangeFocus`
- `shouldAddImportantMention`

Current replay coverage includes:

- focus維持
- focusロック中の別議題発話
- 話題転換
- 脇道
- TODO
- concern
- agreement/noise
- correction
- 代名詞参照

Use this before and after changing intent rules, synonym lists, scoring, or Focus Gate logic.

## Validation Requirement

Before finishing topic/focus related work, run:

```sh
npm test
npm run typecheck
npm run build
```

At the time of this handoff, all three passed.

## Next Recommended Work

Prefer this order:

1. improve replay fixture quality when a new failure pattern is discovered
2. refine `intentRules.ts`
3. refine topic keywords and `normalizedTerms`
4. refine score breakdown and Focus Gate thresholds
5. only consider embeddings or LLMs after rule-based failure modes are clearly measured
