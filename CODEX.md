# Codex Instructions

## Start Here

Before making changes in this repository, read:

- `docs/NEXT_THREAD_HANDOFF.md`

That file is the current source of truth for the Live Topic Graph prototype, including architecture, Focus Gate behavior, known limitations, and recommended next work.

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
- Vitest tests for detection utilities

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
- UI should show topic labels such as `速度`, not internal ids such as `latency`, unless debugging state explicitly requires ids.
- Existing deleted files under `some_designs/*` are unrelated dirty work; do not restore or revert them unless explicitly asked.
