import { useCallback, useState } from "react";
import { IdeaModeView } from "./components/IdeaModeView";
import { MeetingMode } from "./components/MeetingMode";
import { createIdeaSessionStore } from "./hooks/ideaSessionStore";
import { createIdeaSessionFromMeetingSelection } from "./utils/ideaSession";
import type { AnalyzedSegment, MeetingSummary } from "./types/topic";

type AppMode = "idea" | "meeting";

export default function App() {
  const [mode, setMode] = useState<AppMode>("meeting");
  const [meetingVisited, setMeetingVisited] = useState(true);
  const [ideaStore] = useState(() => createIdeaSessionStore());
  const startIdeaSessionFromMeeting = useCallback(
    (summary: MeetingSummary, segments: AnalyzedSegment[], selectedItemIds: string[]) => {
      ideaStore.replaceSession(createIdeaSessionFromMeetingSelection(summary, segments, selectedItemIds));
      setMode("idea");
    },
    [ideaStore],
  );

  return (
    <main className={`app-shell is-${mode}-mode`}>
      <nav className="mode-switch" aria-label="app mode">
        <button type="button" className={mode === "idea" ? "is-active" : ""} onClick={() => setMode("idea")}>
          アイデア出しモード
        </button>
        <button type="button" className={mode === "meeting" ? "is-active" : ""} onClick={() => { setMeetingVisited(true); setMode("meeting"); }}>
          会議モード
        </button>
      </nav>
      {mode === "idea" ? <IdeaModeView store={ideaStore} /> : null}
      {meetingVisited ? <div hidden={mode !== "meeting"}>
        <MeetingMode active={mode === "meeting"} onStartIdeaSession={startIdeaSessionFromMeeting} />
      </div> : null}
    </main>
  );
}
