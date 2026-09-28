import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopicEngineStore } from "./topicEngineStore";

// Golden test for the slide-9 demo: 判断材料 appear only when both a release
// context and a stated concern exist, and they name what would change the choice.
const RELEASE_MEETING = [
  "今日は新機能の公開日を決めます",
  "金曜に全員へ公開したいです",
  "営業からも早く出してほしいと言われています",
  "ただ、決済まわりで不具合が出たら怖いですね",
  "障害が起きたときに止められる人がいるか分からない",
];

function analyze(lines: string[]) {
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const store = createTopicEngineStore();
  for (const text of lines) {
    store.submitTranscript(text, "manual");
    now += 5_000;
  }
  store.analyzeDecisionSupport();
  return store.getSnapshot();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("golden: 公開判断の判断材料", () => {
  it("公開と懸念がそろうと、判断を変え得る3つの材料を出す", () => {
    const materials = analyze(RELEASE_MEETING).decisionSupport.materials;
    expect(materials.map((m) => m.title)).toEqual(["公開時の停止判断と対応体制", "公開範囲を比較する", "速度と安全性の優先度"]);
    expect(materials[0].unknown).toContain("停止判断をする担当者");
    expect(materials[1].conditionalHypothesis.then).toBe("全面公開を選ばない可能性がある");
  });

  it("材料は実際の発言だけを根拠にする", () => {
    const snapshot = analyze(RELEASE_MEETING);
    const texts = new Map(snapshot.segmentArchive.map((segment) => [segment.id, segment.text]));
    for (const material of snapshot.decisionSupport.materials) {
      for (const id of material.sourceEvidenceSegmentIds) expect(RELEASE_MEETING).toContain(texts.get(id));
    }
    expect(snapshot.decisionSupport.materials[0].confirmed).toEqual(["金曜に全員へ公開したいです", "障害が起きたときに止められる人がいるか分からない"]);
  });

  it("懸念が出ていなければ何も出さない", () => {
    expect(analyze(RELEASE_MEETING.slice(0, 3)).decisionSupport.materials).toEqual([]);
  });

  it("文化祭の会議では判断材料を出さない", () => {
    const festival = analyze(["今日は文化祭の出し物を決めます", "じゃあ出し物は対戦ゲームで決定にしよう", "サーバーはどうする？学校のWi-Fiで大丈夫かな", "ゲーム本体は鈴木くん、来週金曜までにプロトタイプお願い"]);
    expect(festival.decisionSupport.materials).toEqual([]);
  });
});
