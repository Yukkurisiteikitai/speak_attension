# Handoff: Source Linked Discussion Tracker

## Objective

This workspace contains a static browser prototype for examining how deictic expressions in meetings and spoken discussions are grounded.

The target product behavior is:

- Capture live speech or manual utterances.
- Assign each utterance a stable source id such as `S1`, `S2`, `S3`.
- Detect when a deictic expression such as 「これ」「それ」「あれ」 appears.
- Trace what earlier utterance, topic, or issue that expression most likely refers to.
- Create or update cards that keep the expression, its candidate referent, and supporting source utterances together.
- At the end of discussion, show which references were resolved and which remain ambiguous.

This is not intended to be a polished meeting minutes app yet. The current prototype validates the interaction model: source-backed discussion tracking for deictic reference inspection.

## Current Implementation

Files:

- `index.html`: Static UI structure.
- `styles.css`: Layout and visual states.
- `app.js`: Speech/manual input, topic detection, issue tracking, summary generation, JSON export.

No build step, package manager, backend, or external API is currently used.

Open `index.html` directly for manual and sample testing. For microphone testing, serve the directory from `localhost` in a Chromium-based browser because Web Speech API support is browser-dependent.

## UI Structure

The page has four main areas:

1. Top controls
   - `開始`: starts browser speech recognition when supported.
   - `終了して整理`: stops recording if active and builds the final summary.
   - `サンプル`: injects sample utterances.
   - `リセット`: clears all local state.

2. Summary strip
   - Current topic.
   - Topic shift count.
   - Total issue count.
   - Answered count.
   - Open/unanswered count.

3. Source panel
   - Lists utterances as source cards.
   - Each source receives `S1`, `S2`, etc.
   - Topic-shift utterances get a visual left border.
   - Issue card source buttons scroll back to these source cards.

4. Issue panel and side panel
   - Issue cards are grouped visually by status:
     - `answered`: green left border.
     - `open`: red left border.
   - Active/current topic card is highlighted.
   - Manual input, final summary, and JSON log live in the right panel.
   - Future UI work should make deictic references and their candidate antecedents explicit.

## Runtime State

All state is held in the `state` object in `app.js`.

Important fields:

```js
const state = {
  recognition: null,
  running: false,
  startedAt: null,
  timerId: null,
  flushId: null,
  buffer: "",
  sources: [],
  issues: [],
  currentTopicId: null,
  shiftCount: 0,
};
```

### `state.sources`

Each source is an utterance-level record:

```js
{
  id: 1,
  label: "S1",
  text: "...",
  sourceType: "manual" | "speech" | "sample",
  at: "ISO timestamp",
  topicId: "source",
  topicLabel: "根拠ソース",
  issueId: "I1",
  shifted: false
}
```

### `state.issues`

Each issue is a discussion-level card:

```js
{
  id: "I1",
  topicId: "source",
  topicLabel: "根拠ソース",
  title: "...",
  status: "open" | "answered",
  issue: "...",
  answer: "...",
  sources: ["S1", "S2"],
  answerSources: ["S2"],
  evidence: [
    { source: "S1", text: "..." }
  ],
  createdAt: "ISO timestamp",
  updatedAt: "ISO timestamp"
}
```

## Processing Flow

Main flow:

```text
speech/manual/sample text
-> addSource(text, sourceType)
-> detectTopic(text)
-> detect topic shift against state.currentTopicId
-> upsertIssue(text, source, topic, shifted)
-> render()
```

Important functions:

- `addSource(text, sourceType)`
  - Creates the next `S*` source id.
  - Detects topic.
  - Increments `shiftCount` if topic changed.
  - Calls `upsertIssue`.
  - Adds the source to `state.sources`.

- `detectTopic(text)`
  - Keyword-based topic classifier using `TOPICS`.
  - Returns a known topic when keywords match.
  - Falls back to a compact free-text label.

- `upsertIssue(text, source, topic, shifted)`
  - Classifies utterance as `issue`, `answer`, or `note`.
  - Reuses an open issue for the same topic when possible.
  - Creates a new issue when topic shifted or utterance looks like a new issue.
  - Marks an issue `answered` when answer-like language is detected.

- `buildFinalSummary()`
  - Splits issues into answered and unanswered.
  - Renders the final summary area.

- `render()`
  - Updates counters, source list, issue board, and JSON log.

## Current Detection Logic

The current implementation is intentionally lightweight and runs without an LLM.

### Topic Detection

`TOPICS` is a static keyword list:

- `source`: source, citation, evidence, utterance id.
- `topic-shift`: topic changes, agenda changes, digressions.
- `issue-answer`: issues, answers, unresolved items.
- `stt`: speech recognition and transcription.
- `ui`: display, cards, highlighting, NotebookLM-like UI.

The topic with the highest keyword hit count wins.

### Topic Shift Detection

Topic shift is currently:

```text
previous topic exists && previous topic id !== current topic id
```

This is simple and will over-detect shifts when wording changes. A future implementation should use embeddings or an LLM classifier.

### Issue vs Answer Classification

`classifySentence(text)` checks keyword hits:

- `ISSUE_HINTS`: 課題, 問題, 懸念, 難しい, できない, 必要, 不足, 未回答, どう, なぜ, どこ
- `ANSWER_HINTS`: 解決, 対応, 答え, 結論, なので, ために, すれば, として, 方針, 実装

If answer hits exceed issue hits, the utterance is an answer. If any issue hit exists, it is an issue. Otherwise it is a note.

Known limitation: Japanese meeting language is ambiguous, so this will misclassify many natural utterances.

## Current Capabilities

Implemented:

- Browser speech recognition via `SpeechRecognition` / `webkitSpeechRecognition`.
- Manual text input fallback.
- Sample utterance injection.
- Source numbering with `S*`.
- Source-linked issue cards.
- Clickable source references from issue cards.
- Topic shift count.
- Answered/unanswered issue status.
- End-of-discussion summary.
- JSON export.

Not implemented:

- OpenAI Realtime or Deepgram STT.
- LLM-based issue extraction.
- Embedding-based topic similarity.
- Speaker diarization.
- Durable storage.
- PDF or external source ingestion.
- Multi-user collaboration.
- Backend.

## Recommended Next Steps

### Step 1: Replace keyword heuristics with structured LLM extraction

Add an API layer that receives a recent utterance window and returns a strict JSON patch:

```json
{
  "topic": {
    "id": "topic-shift",
    "label": "話題転換検知",
    "is_shift": true,
    "confidence": 0.82
  },
  "issue_patch": {
    "operation": "create|update|answer",
    "target_issue_id": "I3",
    "title": "話題転換時に根拠ソースを保持する",
    "status": "open|answered",
    "issue": "...",
    "answer": "...",
    "source_labels": ["S5", "S6"]
  }
}
```

Keep the UI state shape close to the current `state.sources` and `state.issues`.

### Step 2: Improve topic continuity and reference resolution

Use embeddings or a topic-memory list to decide whether an utterance:

- continues the current topic,
- returns to a previous topic,
- starts a new topic,
- answers a previous open issue.

This should replace the current `previousTopicId !== topic.id` rule.
The same pass should also score which earlier utterance or issue a deictic expression most likely points to.

### Step 3: Add priority-aware unanswered issue handling

The current UI distinguishes answered and unanswered issues, but it does not yet rank unresolved items by importance.
For the next iteration, add a priority layer so unanswered issues can be surfaced as:

- high priority: blocking, repeated, or explicitly urgent
- medium priority: still open, but not blocking
- low priority: minor follow-up or informational

Useful presentation ideas:

- group unanswered cards by priority before rendering
- show a stronger visual treatment for high-priority unresolved cards
- expose summary counts such as `高重要度未回答`, `中重要度未回答`, `低重要度未回答`
- keep the current answered/open split intact so the prototype still reads clearly

This fits the current card-based design better than the earlier mindmap-style approach because the card model already carries status and evidence, and priority can be layered on without changing the core flow.

### Step 4: Integrate real streaming STT

Current Web Speech API is only for quick browser prototyping.

For practical testing, connect one of:

- OpenAI Realtime transcription.
- Deepgram streaming STT.

Expected change:

```text
browser mic
-> websocket/backend
-> STT stream
-> transcript delta/final segment
-> addSource()
```

Do not make TTS part of the core path. This product is STT-first.

### Step 5: Add source inspection UI

NotebookLM-like source behavior should include:

- Source popover or side drawer.
- Highlighted source text fragment.
- Issue card evidence snippets.
- Filter by source.
- Show why an issue was marked answered or unanswered.
- Show the referent chain for each deictic expression and whether it is resolved or ambiguous.

### Step 6: Persist sessions

A later version should save:

- sources,
- issues,
- topic transitions,
- final summary,
- raw transcript,
- model decisions.

For a static prototype, JSON export is enough. For a product prototype, add backend persistence.

## Testing Notes

Manual smoke test:

1. Open `index.html`.
2. Click `サンプル`.
3. Confirm source cards `S1...` are created.
4. Confirm issue cards show source buttons.
5. Click a source button on an issue card.
6. Confirm the matching source card scrolls into view and highlights.
7. Click `終了して整理`.
8. Confirm answered/open sections appear.
9. Click `JSON保存`.

Code check used:

```sh
node --check app.js
```

## Design Direction

The desired direction is not a beautiful auto-generated mind map. The stronger product angle is:

```text
live discussion
-> source-backed utterance tracking
-> deictic expression detection
-> candidate referent linking
-> every claim grounded in source utterances
-> unresolved references visible at the end
```

Keep future UI decisions close to this principle:

- Source traceability is primary.
- Deictic reference resolution is the main research question.
- Topic shift detection is secondary.
- Visual graph generation is optional.
- Final answered/unanswered emphasis is part of the core value.
