import { useRef, useSyncExternalStore } from "react";
import { createIdeaSessionStore, type IdeaSessionStore } from "./ideaSessionStore";

// React-facing adapter over the brainstorm session store, mirroring useTopicEngine.
export function useIdeaSession(providedStore?: IdeaSessionStore) {
  const storeRef = useRef<ReturnType<typeof createIdeaSessionStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createIdeaSessionStore();
  }

  const store = providedStore ?? storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    addUtterance: store.addUtterance,
    cycleDecision: store.cycleDecision,
    finishCapture: store.finishCapture,
    groupingNote: snapshot.groupingNote,
    groupingStatus: snapshot.groupingStatus,
    renameGroup: store.renameGroup,
    reset: store.reset,
    resumeCapture: store.resumeCapture,
    session: snapshot.session,
    setDecision: store.setDecision,
  };
}
