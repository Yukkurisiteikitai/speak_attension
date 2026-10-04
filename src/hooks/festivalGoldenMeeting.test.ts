import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopicEngineStore } from "./topicEngineStore";
import { buildMeetingStateDashboard } from "../utils/meetingStateDashboard";
import { buildCurrentDiscussionState } from "../utils/currentDiscussionState";

// Golden test: the 13-utterance school-festival meeting used on slide 7.
// Runs the same store -> dashboard -> 現在地 path that MeetingMode.tsx renders.
const FESTIVAL_MEETING = [
  "今日は文化祭の出し物を決めます",
  "去年は来場者が少なかったんだよね",
  "ブラウザで遊べる対戦ゲームはどうかな",
  "スマホから参加できるし、いいと思う",
  "集客にもつながりそう",
  "じゃあ出し物は対戦ゲームで決定にしよう",
  "サーバーはどうする？学校のWi-Fiで大丈夫かな",
  "たぶん大丈夫じゃない？",
  "ランキング機能もあったら面白いかも",
  "ポスターも作らないと",
  "顧問の先生に教室の使用許可も取らないとだね",
  "ゲーム本体は鈴木くん、来週金曜までにプロトタイプお願い",
  "じゃあ今日はここまで",
];

function runMeeting() {
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const store = createTopicEngineStore();
  for (const text of FESTIVAL_MEETING) {
    store.submitTranscript(text, "manual");
    now += 5_000;
  }
  const snapshot = store.getSnapshot();
  const { engineState } = snapshot;
  const currentTopic = engineState.meetingGraph.nodes.find((node) => node.id === engineState.currentTopicId) ?? null;
  const dashboard = buildMeetingStateDashboard(engineState.decisionGraph, snapshot.decisionSupport.materials, currentTopic?.title ?? null);
  const current = buildCurrentDiscussionState(engineState.meetingGraph, engineState.currentTopicId, engineState.decisionGraph, snapshot.segmentArchive);
  return { graph: engineState.decisionGraph, dashboard, current };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("golden: 文化祭の出し物を決める13発言", () => {
  it("現在の論点は議題「文化祭の出し物」", () => {
    const { current } = runMeeting();
    expect(current.topicTitle).toBe("文化祭の出し物");
  });

  it("締めの発言があっても現在地は議題の範囲で判定する", () => {
    const { current } = runMeeting();
    expect(current.stage).toBe("resolving_question");
    expect(current.decisionThemeTitle).toBe("文化祭の出し物");
  });

  it("決まったことは対戦ゲームの1件だけで、議題は決定にならない", () => {
    const { dashboard } = runMeeting();
    expect(dashboard.confirmedDecisions.map((node) => node.label)).toEqual(["出し物は対戦ゲームに決定"]);
  });

  it("決定の理由として課題・利点・採用された提案がつながる", () => {
    const { dashboard } = runMeeting();
    const [decision] = dashboard.confirmedDecisions;
    const parents = dashboard.reasonsByDecisionId[decision.id].map((node) => `${node.type}:${node.label}`);
    expect(parents).toEqual(expect.arrayContaining([
      "proposal:ブラウザで遊べる対戦ゲーム",
      "reason:スマホから参加できる",
      "reason:集客にもつながりそう",
      "problem:去年は来場者が少なかったんだよね",
    ]));
  });

  it("未解決はWi-Fiの問いとランキング機能の提案だけ", () => {
    const { dashboard } = runMeeting();
    expect(dashboard.unresolvedItems.map((node) => `${node.type}:${node.label}`)).toEqual([
      "question:サーバーはどうする？学校のWi-Fiで大丈夫かな",
      "proposal:ランキング機能",
    ]);
  });

  it("画面では未解決（Wi-Fi）と提案中（ランキング機能）を分けて出す", () => {
    const { dashboard } = runMeeting();
    expect(dashboard.openItems.map((node) => node.label)).toEqual(["サーバーはどうする？学校のWi-Fiで大丈夫かな"]);
    expect(dashboard.pendingProposals.map((node) => node.label)).toEqual(["ランキング機能"]);
  });

  it("次にやることは3件で、鈴木・来週金曜のプロトタイプを含む", () => {
    const { dashboard } = runMeeting();
    const actions = dashboard.nextActions.map((node) => ({ what: node.action?.what, owner: node.action?.owner, deadline: node.action?.deadline }));
    expect(actions).toHaveLength(3);
    expect(actions).toEqual(expect.arrayContaining([
      { what: "ゲーム本体のプロトタイプ", owner: "鈴木", deadline: "来週金曜まで" },
      { what: "ポスターを作る", owner: undefined, deadline: undefined },
      { what: "顧問の先生に教室の使用許可を取る", owner: undefined, deadline: undefined },
    ]));
  });

  it("担当・期限が未定のアクションは構造上の不足として出る", () => {
    const { dashboard } = runMeeting();
    expect(dashboard.structuralGaps.map((gap) => gap.actionLabel).sort()).toEqual(["ポスターを作る", "顧問の先生に教室の使用許可を取る"].sort());
  });
});
