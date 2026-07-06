# Handoff: attension_mindmap

## Objective

This workspace contains a local prototype for deriving meeting-specific topics from live Japanese speech and visualizing them as a React Flow topic map.

The current version is meeting-first. It no longer uses fixed seed product topics. It now includes dynamic topic extraction, topic coverage tracking, topic closure, gap generation, a meeting-wide missing-items summary, and a collapsible dev drawer for diagnostics.

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
npm run lint
npm run typecheck
npm test
npm run build
```

Latest verified results:

- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm test`: passed, 5 files / 19 tests
- `npm run build`: passed

## Implemented

- Microphone start/stop.
- Japanese Web Speech API transcription with interim and final text display.
- 5-second segmentation of finalized speech chunks.
- Manual text mode and replay JSON scenario mode.
- Meeting-specific topic extraction from transcript clauses.
- React Flow topic graph with active topic, discussed topics, and synthetic missing nodes.
- Topic coverage tracking for decision, reason, owner, due date, next action, risk, alternative, objection, dependency, and open-question resolution.
- Automatic topic closure after focus shift plus quiet window.
- Local gap generation and meeting-wide gap summary.
- Rule-based utterance intent classification.
- Lightweight topic phrase overlap matching with aliases.
- Manual Focus select and clear.
- Focus lock.
- Decision Log with topic-match breakdown.
- Important off-focus mention capture.
- Simple topic reference resolution.
- Lightweight local WebSocket relay for session log events.
- Store-backed topic engine state management via `useSyncExternalStore`.
- Aggregated transcript JSON validation errors before import failure.
- GitHub Actions for CI and Cloudflare Pages deploy.
- Utility script to kill stale localhost dev servers by port.

## Key Files

- `docs/NEXT_THREAD_HANDOFF.md` - detailed current handoff
- `src/hooks/useTopicEngine.ts` - thin hook adapter over the topic engine store
- `src/hooks/topicEngineStore.ts` - store for engine state, buffered speech, logs, and commands
- `src/types/topic.ts` - shared meeting graph / topic / gap / analysis types
- `src/utils/topicRules.ts` - compatibility exports for split topic utilities
- `src/utils/intentRules.ts` - intent detection
- `src/utils/topicEngine.ts` - segment processing orchestrator
- `src/utils/topicExtraction.ts` - clause splitting, phrase extraction, matching, references
- `src/utils/topicCoverage.ts` - coverage markers, gap generation, lifecycle display rules
- `src/utils/topicProjection.ts` - graph bootstrap, React Flow projection, id helpers
- `src/utils/topicLifecycle.ts` - coverage mutation, topic closure, mention creation
- `src/utils/topicSelection.ts` - topic selection and topic creation helpers
- `src/utils/transcriptImporter.ts` - transcript JSON parsing with aggregated validation errors
- `src/components/TopicInspector.tsx` - current topic, coverage, gap lists, dev drawer
- `.github/workflows/ci.yml` - lint/typecheck/test/build workflow
- `.github/workflows/cloudflare-pages.yml` - Pages deployment workflow using `npx wrangler@4`
- `scripts/kill-localhost-port.sh` - port cleanup helper

## Current Limitations

- Detection is deterministic and rule-based.
- Topic phrase extraction is heuristic and clause-based, not morphological.
- Reference resolution is intentionally shallow.
- State is in memory only and resets on refresh.
- Topic closure still depends on simple segment/time windows.
- Transcript import stays strict: one invalid segment causes the entire import to fail, but all validation errors are collected first.

## Cloudflare Cache Note

Cloudflare Pages deployment is already wired, and edge cache headers are committed in the repo.

Implemented config:

- `public/_headers` is copied to `dist/_headers` by Vite on build.
- Cache headers:

```txt
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*
  Cache-Control: public, max-age=0, must-revalidate
```

- Reason:

- hashed JS/CSS/image assets should be cached aggressively at the Cloudflare edge
- HTML should stay revalidating so new deployments become visible immediately

Do not confuse this with GitHub Actions dependency caching. The intended action is Cloudflare edge/static asset caching via Pages headers.
