# Code Guide

This repository is a local, rule-based meeting-topic prototype. The goal of this guide is to explain the code layout without forcing a reader to trace every file in execution order.

## Read This First

1. `src/App.tsx`
2. `src/hooks/useTopicEngine.ts`
3. `src/hooks/topicEngineStore.ts`
4. `src/utils/topicEngine.ts`
5. `src/utils/topicExtraction.ts`
6. `src/utils/topicSelection.ts`
7. `src/utils/topicCoverage.ts`
8. `src/components/TopicInspector.tsx`

## Mental Model

The app has three layers:

- UI layer: React components render the dashboard and diagnostic panels.
- Store layer: a local external store keeps the latest engine state and user commands.
- Engine layer: pure utilities turn each transcript segment into a graph update.

## Data Flow

```txt
speech / manual text / replay
-> useTopicEngine
-> topicEngineStore
-> processTopicSegment
-> topic extraction + scoring + coverage + lifecycle
-> MeetingGraph update
-> TopicInspector / TopicGraph render
```

## File Map

### `src/App.tsx`

App shell and layout. It wires speech recognition, topic engine state, and the panels together.

### `src/hooks/useTopicEngine.ts`

Thin React adapter over the store. It exposes the engine state to the UI and keeps the periodic flush timer.

### `src/hooks/topicEngineStore.ts`

Mutable runtime store. It receives commands, owns the current snapshot, and emits logs.

### `src/utils/topicEngine.ts`

Segment processing orchestrator. This is the main place to read when you want to understand what happens after one utterance arrives.

### `src/utils/topicExtraction.ts`

Clause splitting, phrase extraction, and reference resolution.

### `src/utils/topicSelection.ts`

Topic matching and topic creation rules.

### `src/utils/topicCoverage.ts`

Coverage detection, gap generation, lifecycle derivation, and gap sorting.

### `src/utils/topicLifecycle.ts`

Coverage mutation, topic closure, and important mention creation.

### `src/components/TopicInspector.tsx`

Diagnostic side panel. It shows current topic, gaps, coverage, latest analysis, and the developer drawer.

## If You Need To Change Behavior

- Topic classification changes usually start in `src/utils/topicExtraction.ts` or `src/utils/topicSelection.ts`.
- Gap / missing-information changes usually start in `src/utils/topicCoverage.ts`.
- UI explanation changes usually start in `src/components/TopicInspector.tsx`.
- Store and command flow changes usually start in `src/hooks/topicEngineStore.ts`.

## Validation

When you change the engine or explanation flow, run:

```sh
npm test
npm run typecheck
npm run build
```
