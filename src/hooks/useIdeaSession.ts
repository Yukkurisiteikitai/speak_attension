import { useRef, useSyncExternalStore } from "react";
import { createIdeaSessionStore } from "./ideaSessionStore";

// React-facing adapter over the brainstorm session store, mirroring useTopicEngine.
export function useIdeaSession() {
  const storeRef = useRef<ReturnType<typeof createIdeaSessionStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createIdeaSessionStore();
  }

  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    addUtterance: store.addUtterance,
    finishCapture: store.finishCapture,
    groupingNote: snapshot.groupingNote,
    groupingStatus: snapshot.groupingStatus,
    reset: store.reset,
    resumeCapture: store.resumeCapture,
    session: snapshot.session,
    togglePick: store.togglePick,
  };
}
