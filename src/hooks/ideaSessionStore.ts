import { groupIdeasByRules, groupIdeasWithLlm } from "../utils/ideaGrouping";
import {
  addIdeaUtterance,
  applyGrouping,
  beginGrouping,
  cycleKeywordDecision,
  createInitialIdeaSessionState,
  renameIdeaGroup,
  resumeCapture,
  setKeywordDecision,
  type IdeaDecision,
  type IdeaSessionState,
  type IdeaUtteranceSource,
} from "../utils/ideaSession";
import type { LlmSettings } from "../utils/llmClient";

export type IdeaGroupingStatus = "idle" | "running" | "done" | "error";

export type IdeaSessionStoreSnapshot = {
  session: IdeaSessionState;
  groupingStatus: IdeaGroupingStatus;
  groupingNote: string | null;
};

export type FinishCaptureOptions = {
  llmSettings?: LlmSettings | null;
};

export type IdeaSessionStore = {
  addUtterance: (text: string, source: IdeaUtteranceSource) => void;
  finishCapture: (options?: FinishCaptureOptions) => Promise<void>;
  getSnapshot: () => IdeaSessionStoreSnapshot;
  renameGroup: (groupId: string, title: string) => void;
  replaceSession: (session: IdeaSessionState) => void;
  reset: () => void;
  resumeCapture: () => void;
  cycleDecision: (keywordId: string) => void;
  setDecision: (keywordId: string, decision: IdeaDecision) => void;
  subscribe: (listener: () => void) => () => void;
};

// Owns brainstorm session state. Grouping is the only async transition:
// LLM grouping is attempted when settings are provided and silently falls
// back to rule-based clustering so 出し終わった always completes.
export function createIdeaSessionStore(initialSession: IdeaSessionState = createInitialIdeaSessionState()): IdeaSessionStore {
  let snapshot: IdeaSessionStoreSnapshot = {
    session: initialSession,
    groupingStatus: "idle",
    groupingNote: null,
  };
  const listeners = new Set<() => void>();

  function write(next: Partial<IdeaSessionStoreSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  }

  return {
    addUtterance(text, source) {
      const next = addIdeaUtterance(snapshot.session, text, source);
      if (next === snapshot.session) return;
      write({ session: next });
    },
    async finishCapture(options = {}) {
      const started = beginGrouping(snapshot.session);
      if (started === snapshot.session) return;
      write({ session: started, groupingStatus: "running", groupingNote: null });

      const { llmSettings } = options;
      if (llmSettings?.model) {
        try {
          const groups = await groupIdeasWithLlm(llmSettings, started.keywords, started.utterances);
          write({
            session: applyGrouping(started, groups, "llm"),
            groupingStatus: "done",
            groupingNote: `ローカルLLM(${llmSettings.model})でグループ化しました。`,
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          write({
            session: applyGrouping(started, groupIdeasByRules(started.keywords), "rules"),
            groupingStatus: "done",
            groupingNote: `LLMグループ化に失敗したためルールベースを使用しました: ${message}`,
          });
          return;
        }
      }

      write({
        session: applyGrouping(started, groupIdeasByRules(started.keywords), "rules"),
        groupingStatus: "done",
        groupingNote: "ルールベースでグループ化しました。",
      });
    },
    getSnapshot() {
      return snapshot;
    },
    renameGroup(groupId, title) {
      const next = renameIdeaGroup(snapshot.session, groupId, title);
      if (next === snapshot.session) return;
      write({ session: next });
    },
    replaceSession(session) {
      write({ session, groupingStatus: "idle", groupingNote: null });
    },
    reset() {
      write({
        session: createInitialIdeaSessionState(),
        groupingStatus: "idle",
        groupingNote: null,
      });
    },
    resumeCapture() {
      const next = resumeCapture(snapshot.session);
      if (next === snapshot.session) return;
      write({ session: next, groupingStatus: "idle", groupingNote: null });
    },
    cycleDecision(keywordId) {
      const next = cycleKeywordDecision(snapshot.session, keywordId);
      if (next === snapshot.session) return;
      write({ session: next });
    },
    setDecision(keywordId, decision) {
      const next = setKeywordDecision(snapshot.session, keywordId, decision);
      if (next === snapshot.session) return;
      write({ session: next });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
