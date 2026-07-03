# Handoff: Live Topic Graph

## Objective

This workspace contains a v0.1 prototype for detecting the current topic from live Japanese speech and highlighting topic nodes in a React Flow graph.

The goal is to validate the feeling that agenda nodes react live to a conversation. It is not a finished meeting-minutes product.

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

Open the Vite URL in a Chromium-based browser. Web Speech API support is browser-dependent, and microphone capture usually requires `localhost` or HTTPS.

## Structure

```txt
server/
  index.ts
src/
  App.tsx
  main.tsx
  components/
    ControlPanel.tsx
    TranscriptPanel.tsx
    TopicGraph.tsx
    TopicInspector.tsx
  hooks/
    useSpeechRecognition.ts
    useTopicEngine.ts
  types/
    topic.ts
  utils/
    topicRules.ts
```

## Implemented

- Microphone start/stop.
- Japanese Web Speech API transcription with interim and final text display.
- 5-second segmentation of finalized speech chunks.
- Keyword-based topic detection.
- React Flow graph with initial topic nodes.
- Current topic highlighting.
- Topic heat increment and 1-second decay.
- Unknown topic node creation for unmatched utterances of 20+ characters.
- Session log JSON display.
- Lightweight local WebSocket relay for session log events.

## Limitations

- Detection is keyword-based and intentionally rough.
- Segments are built from finalized Web Speech API chunks, so browser behavior affects timing.
- Unknown topic similarity is a simple recent-prefix check.
- State is in memory only and resets on refresh.
