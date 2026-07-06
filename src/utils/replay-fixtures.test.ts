import { describe, expect, it } from "vitest";
import { REPLAY_FIXTURES } from "./replay-fixtures";
import {
  createInitialTopicEngineState,
  processTopicSegment,
  setFocusLockedState,
  setManualFocusState,
  type TopicEngineState,
} from "./topicEngine";

function buildFixtureState(focusTopicId?: string | null, locked?: boolean): TopicEngineState {
  let state = createInitialTopicEngineState(1);
  if (focusTopicId !== undefined) {
    state = setManualFocusState(state, focusTopicId, 2);
  }
  if (locked) {
    state = setFocusLockedState(state, true);
  }
  return state;
}

describe("replay fixtures", () => {
  for (const fixture of REPLAY_FIXTURES) {
    it(fixture.title, () => {
      let state = buildFixtureState(fixture.initialFocusTopicId, fixture.initialFocusLocked);

      fixture.segments.forEach((item, index) => {
        const previousFocusTopicId = state.focusState.focusTopicId;
        const previousImportantMentionCount = state.importantMentions.length;
        const result = processTopicSegment(state, item.text, "replay", 10_000 + index);

        expect(result.segment.analysis.selectedTopicId).toBe(item.expected.expectedTopicId);
        expect(result.segment.analysis.intent).toBe(item.expected.expectedIntent);
        expect(result.segment.analysis.focusRelation).toBe(item.expected.expectedFocusRelation);
        expect(result.importantMention !== null).toBe(item.expected.shouldAddImportantMention);
        expect(result.state.importantMentions.length > previousImportantMentionCount).toBe(item.expected.shouldAddImportantMention);

        const didChangeFocus = previousFocusTopicId !== result.state.focusState.focusTopicId;
        expect(didChangeFocus).toBe(item.expected.shouldChangeFocus);

        state = result.state;
      });
    });
  }
});
