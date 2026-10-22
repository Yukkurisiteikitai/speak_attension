import { describe, expect, it } from "vitest";
import { segmentUnitSpans } from "./segmentUnits";
import { loadCorpus } from "./__corpus__/loadCorpus";
import { getExpectedUnitCount } from "./__corpus__/corpusTypes";

const texts = (text: string) => segmentUnitSpans(text).map((span) => text.slice(span.start, span.end));

describe("segmentUnitSpans: corpus acceptance", () => {
  // `unitCount` describes the case's target utterance -- the last one. Earlier
  // utterances in a case exist only to supply context.
  it.each(loadCorpus().map((testCase) => [testCase.id, testCase] as const))(
    "%s splits its target utterance into the expected number of units",
    (_id, testCase) => {
      const target = testCase.utterances[testCase.utterances.length - 1].text;
      expect(segmentUnitSpans(target)).toHaveLength(getExpectedUnitCount(testCase));
    },
  );
});

describe("segmentUnitSpans: what counts as a boundary", () => {
  it("splits a reason from its consequence at 〜ので、", () => {
    expect(texts("スマホで集客しやすいので、対戦ゲーム形式で進めましょう")).toEqual([
      "スマホで集客しやすいので、",
      "対戦ゲーム形式で進めましょう",
    ]);
  });

  it("splits a contrastive clause opened by ただし", () => {
    expect(texts("昨日のタスクは完了しました。ただし、再テストが必要です")).toEqual([
      "昨日のタスクは完了しました。",
      "ただし、再テストが必要です",
    ]);
  });

  it("does NOT split on a bare sentence break with no relation marker", () => {
    // Three sentences, one unit: nothing marks a relation between them, and an
    // extra unit is another chance to promote a claim nobody made.
    expect(texts("いい質問ですね。そこはまだ検討中です。青チームで検証します")).toHaveLength(1);
    expect(texts("本日の朝会を始めます。進捗報告をお願いします")).toHaveLength(1);
    expect(texts("レイテンシー削減を優先で進めることにします。期限は10月末です")).toHaveLength(1);
  });

  it("treats くて、 as causal but leaves ていて、 alone", () => {
    expect(texts("APIレスポンスが遅くて、再テストが必要です")).toHaveLength(2);
    expect(texts("構成のベースはまず決まっていて、問題、プロセス、デモ")).toHaveLength(1);
  });

  it("does not split a contrastive connective that sits inside a word", () => {
    // 「それでも」/「今でも」 contain でも but do not open a clause.
    expect(texts("それでも対戦ゲーム形式で進めましょう")).toHaveLength(1);
    expect(texts("今でも集客は課題です")).toHaveLength(1);
  });

  it("does not split an enumeration or a topic-marking comma", () => {
    expect(texts("方法としてA、B、Cがあります")).toHaveLength(1);
    expect(texts("ランキング機能については、保留にしておきましょう")).toHaveLength(1);
    expect(texts("今日整理したいことは3つ、スライド作成、コーディング、リファクタリングです")).toHaveLength(1);
  });
});

describe("segmentUnitSpans: span integrity", () => {
  it("returns half-open, non-overlapping spans in document order", () => {
    const text = "スマホで集客しやすいので、対戦ゲーム形式で進めましょう";
    const spans = segmentUnitSpans(text);
    for (const span of spans) {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeLessThanOrEqual(text.length);
      expect(span.end).toBeGreaterThan(span.start);
    }
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index].start).toBeGreaterThanOrEqual(spans[index - 1].end);
    }
  });

  it("keeps spans valid across a surrogate pair", () => {
    const text = "結果は🎉でした。ただし、課題が残っています";
    const spans = segmentUnitSpans(text);
    expect(spans.length).toBe(2);
    // Slicing must not cut the emoji in half.
    const joined = spans.map((span) => text.slice(span.start, span.end)).join("");
    expect(joined).toContain("🎉");
    for (const span of spans) {
      expect(text.slice(span.start, span.end)).not.toContain("�");
    }
  });

  it("returns no spans for text with no content", () => {
    expect(segmentUnitSpans("")).toEqual([]);
    expect(segmentUnitSpans("   \n ")).toEqual([]);
  });

  it("trims surrounding whitespace out of the spans", () => {
    expect(texts("  対戦ゲーム形式を採用します  ")).toEqual(["対戦ゲーム形式を採用します"]);
  });
});
