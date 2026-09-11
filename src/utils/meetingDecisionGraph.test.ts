import { describe, expect, it } from "vitest";
import type { AnalyzedSegment } from "../types/topic";
import {
  appendMeetingDecisionSegment,
  updateMeetingAction,
  createInitialMeetingDecisionGraph,
  selectCurrentActions,
  selectDecisionParents,
  traceDecisionGraphBackwards,
} from "./meetingDecisionGraph";

function segment(id: string, text: string, createdAt: number): AnalyzedSegment {
  return {
    id,
    text,
    createdAt,
    source: "manual",
    matchedTopicIds: [],
    analysis: {
      selectedTopicId: null,
      selectedTopicLabel: null,
      matchedTopicIds: [],
      intent: "unknown",
      focusRelation: "uncertain",
      focusAlignmentScore: 0,
      candidateTopicPhrases: [],
      topicScores: [],
      resolvedReferences: [],
      unresolvedReferences: [],
      shouldUpdateGraph: false,
      shouldUpdateCurrentTopic: false,
      shouldCreateNode: false,
      coverageUpdates: [],
      createdGapIds: [],
      reason: "test",
    },
  };
}

describe("meetingDecisionGraph", () => {
  it("does not mistake a meeting goal for a completed decision", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("goal", "今日は連絡方法について決めます", 0));
    expect(graph.nodes.map((node) => node.type)).toEqual(["utterance"]);
  });

  it("links a uniquely named adopted option and leaves ambiguous comparisons unlinked", () => {
    const base = ["A案でメールを自動化しましょう", "B案で電話を増やしましょう"].reduce((graph, text, index) => appendMeetingDecisionSegment(graph, segment(`p${index}`, text, index)), createInitialMeetingDecisionGraph());
    const chosen = appendMeetingDecisionSegment(base, segment("choice", "A案を採用します", 3));
    expect(chosen.edges).toContainEqual(expect.objectContaining({ source: "decision-choice", target: "proposal-p0", relation: "decided_from" }));
    const ambiguous = appendMeetingDecisionSegment(base, segment("comparison", "A案とB案を比較します", 3));
    expect(ambiguous.edges.some((edge) => edge.source === "decision-comparison" && edge.target.startsWith("proposal-") && edge.relation === "decided_from")).toBe(false);
  });
  it("extracts a general action, causal reason, owner and deadline with source attribution", () => {
    const input = { ...segment("general", "資料が不足しているので、田中さんが明日までに資料を作成します", 1000), metadata: { speaker: "佐藤" } };
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), input);
    const [action] = selectCurrentActions(graph);
    expect(action.action).toMatchObject({ what: "田中さんが明日までに資料を作成します", why: "資料が不足している", owner: "田中", deadline: "明日まで" });
    expect(action.action?.whyNow).toBeUndefined();
    const parents = selectDecisionParents(graph, action.id);
    expect(parents.map((node) => node.type)).toEqual(["decision", "utterance"]);
    const trace = traceDecisionGraphBackwards(graph, action.id);
    expect(trace.find((node) => node.type === "reason")?.label).toBe("資料が不足している");
    expect(trace.find((node) => node.type === "utterance")).toMatchObject({ label: input.text, speaker: "佐藤", createdAt: 1000 });
    expect(appendMeetingDecisionSegment(graph, input)).toBe(graph);
  });

  it.each(["実施しますか？", "実施します？", "資料作成を提案します", "どうして実施します", "実施するかもしれない", "実施するとしたら", "実施しません", "実施する方針は撤回します", "進めよう", "決めよう"])("does not turn %s into a decided action", (text) => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("s1", text, 1000));
    expect(selectCurrentActions(graph)).toEqual([]);
  });

  it("connects a general proposal to an explicit agreement", () => {
    let graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("s1", "資料を作成しましょう", 1000));
    expect(selectCurrentActions(graph)).toEqual([]);
    graph = appendMeetingDecisionSegment(graph, segment("s2", "それでいこう", 2000));
    const [action] = selectCurrentActions(graph);
    expect(action.label).toBe("資料を作成しましょう");
    expect(traceDecisionGraphBackwards(graph, action.id).some((node) => node.type === "proposal")).toBe(true);
  });

  it("does not reuse evidence or proposals across an explicit topic boundary", () => {
    const graph = ["このまま動かすと壊れたデータが増える", "一度v1.42に戻そう", "次の議題です", "資料を作成します"].reduce(
      (state, text, index) => appendMeetingDecisionSegment(state, segment(`s${index}`, text, index)), createInitialMeetingDecisionGraph(),
    );
    const [action] = selectCurrentActions(graph);
    expect(action.action?.why).toBeUndefined();
    expect(traceDecisionGraphBackwards(graph, action.id).map((node) => node.type)).not.toContain("risk");
  });

  it("does not present a tentative risk as a confirmed reason", () => {
    const graph = ["このままだと損失が増えるかもしれない", "資料を作成します"].reduce(
      (state, text, index) => appendMeetingDecisionSegment(state, segment(`s${index}`, text, index)), createInitialMeetingDecisionGraph(),
    );
    expect(selectCurrentActions(graph)[0].action?.why).toBeUndefined();
    expect(selectCurrentActions(graph)[0].action?.whyNow).toBeUndefined();
    expect(graph.nodes.find((node) => node.type === "risk")?.state).toBe("unconfirmed");
  });

  it("terminates reverse traversal even when an imported graph has a cycle", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("s1", "資料を作成します", 1000));
    const [action] = selectCurrentActions(graph);
    graph.edges.push({ id: "cycle", source: "utterance-s1", target: action.id, relation: "supports" });
    const trace = traceDecisionGraphBackwards(graph, action.id);
    expect(new Set(trace.map((node) => node.id)).size).toBe(trace.length);
  });

  it("builds a decided action with a backward path to the original evidence", () => {
    const texts = [
      "新バージョンにしてからエラー率が35%になっています",
      "新バージョンが原因かもしれない",
      "DBのwriteで3件壊れています",
      "このまま動かすと壊れたデータが増える",
      "一度v1.42に戻そう",
      "それでいこう。今すぐロールバック",
    ];
    const graph = texts.reduce(
      (current, text, index) => appendMeetingDecisionSegment(current, segment(`s${index + 1}`, text, 1_000 + index)),
      createInitialMeetingDecisionGraph(),
    );

    const [action] = selectCurrentActions(graph);
    expect(action).toMatchObject({
      type: "action",
      label: "v1.42へロールバック",
      state: "decided",
      action: {
        why: "データ破損を止める",
        whyNow: "稼働を続けるほど破損が増える",
        deadline: "即時",
        urgency: "critical",
        status: "decided",
      },
    });

    const trace = traceDecisionGraphBackwards(graph, action.id);
    expect(trace.map((node) => node.type)).toEqual(expect.arrayContaining(["action", "decision", "risk", "evidence", "utterance"]));
    expect(trace.filter((node) => node.type === "utterance").map((node) => node.label)).toEqual(
      expect.arrayContaining([texts[0], texts[2], texts[3]]),
    );
    expect(graph.nodes.find((node) => node.type === "reason")?.state).toBe("unconfirmed");
  });

  it("connects only an explicit answer to the latest unresolved question", () => {
    let graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("q", "ロールバックは誰が担当しますか？", 1));
    graph = appendMeetingDecisionSegment(graph, segment("guess", "田中さんかもしれません", 2));
    expect(graph.edges.some((edge) => edge.relation === "answers")).toBe(false);
    graph = appendMeetingDecisionSegment(graph, segment("answer", "ロールバックは田中さんが担当します", 3));
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "utterance-answer", target: "question-q", relation: "answers" }));
  });

  it("does not turn an unconfirmed human inference into a decision", () => {
    const graph = appendMeetingDecisionSegment(
      createInitialMeetingDecisionGraph(),
      segment("s1", "新バージョンが原因かもしれない", 1_000),
    );

    expect(graph.nodes.find((node) => node.type === "reason")).toMatchObject({ state: "unconfirmed" });
    expect(selectCurrentActions(graph)).toEqual([]);
  });
});

describe("explicit action updates", () => {
  it("updates only the target, preserves the decision and traces the outcome to its original source", () => {
    const initial = ["資料を作成します", "テストを実施します"].reduce(
      (graph, text, index) => appendMeetingDecisionSegment(graph, segment(String(index), text, index)),
      createInitialMeetingDecisionGraph(),
    );
    const target = selectCurrentActions(initial)[0];
    const next = updateMeetingAction(initial, target.id, { status: "done", owner: "田中", note: "資料を確認しました" }, { id: "update-1", createdAt: 3 });
    expect(selectCurrentActions(next)).toHaveLength(1);
    expect(selectCurrentActions(initial)).toHaveLength(2);
    expect(next.nodes.find((node) => node.id === target.id)?.action).toMatchObject({ status: "done", owner: "田中" });
    expect(traceDecisionGraphBackwards(next, "update-1").map((node) => node.type)).toEqual(expect.arrayContaining(["outcome", "action", "decision", "utterance"]));
    expect(updateMeetingAction(next, target.id, { note: "重複" }, { id: "update-1", createdAt: 4 })).toBe(next);
    expect(updateMeetingAction(next, target.id, { note: " " }, { id: "empty", createdAt: 4 })).toBe(next);
    const reopened = updateMeetingAction(next, target.id, { status: "in_progress", note: "追加作業が必要" }, { id: "reopen", createdAt: 5 });
    expect(selectCurrentActions(reopened)).toHaveLength(2);
    const cancelled = updateMeetingAction(reopened, target.id, { status: "cancelled", note: "方針変更" }, { id: "cancel", createdAt: 6 });
    expect(selectCurrentActions(cancelled)).toHaveLength(1);
  });
});

it("links problem, question, proposal and decision back to evidence without crossing topics", () => {
  const texts = ["エラーが3件発生しています", "資料不足が課題です", "どう改善しますか？", "資料を作成しましょう", "それでいこう"];
  const graph = texts.reduce((state, text, index) => appendMeetingDecisionSegment(state, segment(`chain-${index}`, text, index)), createInitialMeetingDecisionGraph());
  const trace = traceDecisionGraphBackwards(graph, selectCurrentActions(graph)[0].id);
  expect(trace.map((n) => n.type)).toEqual(expect.arrayContaining(["problem", "question", "proposal", "decision", "evidence", "utterance"]));
  const boundary = appendMeetingDecisionSegment(graph, segment("boundary", "次の議題です", 10));
  const next = appendMeetingDecisionSegment(boundary, segment("new-question", "どう進めますか？", 11));
  expect(selectDecisionParents(next, "question-new-question").map((n) => n.type)).toEqual(["utterance"]);
});
