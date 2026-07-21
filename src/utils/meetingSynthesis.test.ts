import { describe, expect, it } from "vitest";
import { createInitialTopicEngineState, processTopicSegment } from "./topicEngine";
import { buildRuleBasedMeetingSummary, renameMeetingSummaryNode } from "./meetingSynthesis";

function sampleState() {
  const texts = [
    "今日は採用フローの短縮について決めます",
    "候補者連絡の遅さが問題です",
    "理由は担当が曖昧だからです",
    "佐藤さんが金曜までに改善案を出します",
    "ただ、別案も見た方がいいです",
    "そうですね",
    "どうぞ",
    "採用フローの前にAIを導入するのはどうでしょうか? 先に履歴書を見て判断するのです",
    "AIを使うと新しい知識を連れてくる人を見つけられないのではないでしょうか?",
    "AIに詳しい人があまり社内にいないのですが本当によろしいのでしょうか",
    "私は趣味でAIを触っていました。任せてください。",
    "よし一週間限定で試してみよう。AIでどこまで短縮できるか一週間以内に準備してくれ",
  ];
  let state = createInitialTopicEngineState(0);
  const segments = [];
  for (const [index, text] of texts.entries()) {
    const transition = processTopicSegment(state, text, "replay", index * 1_000);
    state = transition.state;
    segments.push(transition.segment);
  }
  return { state, segments };
}

describe("buildRuleBasedMeetingSummary", () => {
  it("keeps the recruitment and AI discussion traceable while excluding acknowledgements", () => {
    const { state, segments } = sampleState();
    const summary = buildRuleBasedMeetingSummary({ meetingGraph: state.meetingGraph, segments, now: 99 });
    const items = summary.topics.flatMap((topic) => topic.items);

    expect(summary.ignoredSegmentIds).toContain(segments[5].id);
    expect(summary.ignoredSegmentIds).toContain(segments[6].id);
    expect(items.some((item) => item.category === "issue" && item.evidenceSegmentIds.includes(segments[1].id))).toBe(true);
    expect(items.some((item) => item.category === "cause" && item.evidenceSegmentIds.includes(segments[2].id))).toBe(true);
    expect(items.some((item) => item.category === "action" && item.evidenceSegmentIds.includes(segments[3].id))).toBe(true);
    expect(items.some((item) => item.category === "concern" && item.evidenceSegmentIds.includes(segments[8].id))).toBe(true);
    expect(items.some((item) => item.category === "decision" && item.evidenceSegmentIds.includes(segments[11].id))).toBe(true);
    expect(items.some((item) => item.category === "action" && item.evidenceSegmentIds.includes(segments[11].id))).toBe(true);
  });

  it("renames only the summary node", () => {
    const { state, segments } = sampleState();
    const summary = buildRuleBasedMeetingSummary({ meetingGraph: state.meetingGraph, segments, now: 99 });
    const topic = summary.topics[0];
    const renamed = renameMeetingSummaryNode(summary, topic.id, "採用の改善");

    expect(renamed.topics[0].title).toBe("採用の改善");
    expect(summary.topics[0].title).not.toBe("採用の改善");
  });
});
