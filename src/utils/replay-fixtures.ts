import type { FocusRelation, UtteranceIntent } from "../types/topic";

export type ReplayExpectedResult = {
  expectedTopicId: string | null;
  expectedIntent: UtteranceIntent;
  expectedFocusRelation: FocusRelation;
  shouldChangeFocus: boolean;
  shouldAddImportantMention: boolean;
};

export type ReplayFixtureSegment = {
  text: string;
  expected: ReplayExpectedResult;
};

export type ReplayFixture = {
  id: string;
  title: string;
  initialFocusTopicId?: string | null;
  initialFocusLocked?: boolean;
  segments: ReplayFixtureSegment[];
};

export const REPLAY_FIXTURES: ReplayFixture[] = [
  {
    id: "focus-keep",
    title: "focus維持と代名詞参照",
    segments: [
      {
        text: "今日はレイテンシー対策を決めます",
        expected: {
          expectedTopicId: "latency",
          expectedIntent: "decision",
          expectedFocusRelation: "on_focus",
          shouldChangeFocus: true,
          shouldAddImportantMention: false,
        },
      },
      {
        text: "それで、さっきの話なんだけど",
        expected: {
          expectedTopicId: null,
          expectedIntent: "unknown",
          expectedFocusRelation: "on_focus",
          shouldChangeFocus: false,
          shouldAddImportantMention: false,
        },
      },
      {
        text: "その件なんだけど、遅延が問題です",
        expected: {
          expectedTopicId: "latency",
          expectedIntent: "concern",
          expectedFocusRelation: "on_focus",
          shouldChangeFocus: false,
          shouldAddImportantMention: false,
        },
      },
    ],
  },
  {
    id: "locked-other-topic",
    title: "focusロック中の別議題発話",
    initialFocusTopicId: "latency",
    initialFocusLocked: true,
    segments: [
      {
        text: "次にコストの料金が高いです",
        expected: {
          expectedTopicId: "cost",
          expectedIntent: "switch_topic",
          expectedFocusRelation: "off_topic_important",
          shouldChangeFocus: false,
          shouldAddImportantMention: false,
        },
      },
    ],
  },
  {
    id: "switch-topic",
    title: "話題転換",
    initialFocusTopicId: "latency",
    segments: [
      {
        text: "次にコストの料金が高いです",
        expected: {
          expectedTopicId: "cost",
          expectedIntent: "switch_topic",
          expectedFocusRelation: "on_focus",
          shouldChangeFocus: true,
          shouldAddImportantMention: false,
        },
      },
    ],
  },
  {
    id: "adjacent-ui",
    title: "脇道",
    initialFocusTopicId: "latency",
    segments: [
      {
        text: "UIのLive感にも関係します",
        expected: {
          expectedTopicId: "ui",
          expectedIntent: "unknown",
          expectedFocusRelation: "adjacent",
          shouldChangeFocus: false,
          shouldAddImportantMention: false,
        },
      },
    ],
  },
  {
    id: "todo-note",
    title: "TODO",
    initialFocusTopicId: "latency",
    segments: [
      {
        text: "あとでAPI料金は確認する",
        expected: {
          expectedTopicId: "cost",
          expectedIntent: "todo",
          expectedFocusRelation: "off_topic_important",
          shouldChangeFocus: false,
          shouldAddImportantMention: true,
        },
      },
    ],
  },
  {
    id: "concern-note",
    title: "concern",
    initialFocusTopicId: "latency",
    segments: [
      {
        text: "精度の認識ミスが問題です",
        expected: {
          expectedTopicId: "accuracy",
          expectedIntent: "concern",
          expectedFocusRelation: "off_topic_important",
          shouldChangeFocus: false,
          shouldAddImportantMention: true,
        },
      },
    ],
  },
  {
    id: "agreement-noise",
    title: "agreement/noise",
    initialFocusTopicId: "latency",
    segments: [
      {
        text: "そうですね",
        expected: {
          expectedTopicId: null,
          expectedIntent: "agreement",
          expectedFocusRelation: "off_topic_noise",
          shouldChangeFocus: false,
          shouldAddImportantMention: false,
        },
      },
    ],
  },
  {
    id: "correction-uncertain",
    title: "correction",
    initialFocusTopicId: "latency",
    segments: [
      {
        text: "いや違う、認識ミスです",
        expected: {
          expectedTopicId: "accuracy",
          expectedIntent: "correction",
          expectedFocusRelation: "uncertain",
          shouldChangeFocus: false,
          shouldAddImportantMention: false,
        },
      },
    ],
  },
];
