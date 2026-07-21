import { describe, expect, it } from "vitest";
import { groupIdeasByRules, parseGroupingResponse } from "./ideaGrouping";
import type { IdeaKeyword } from "./ideaSession";

function keyword(id: string, label: string, overrides: Partial<IdeaKeyword> = {}): IdeaKeyword {
  return {
    id,
    label,
    normalized: label.toLocaleLowerCase("ja-JP"),
    mentionCount: 1,
    utteranceIds: [`utt-${id}`],
    firstMentionedAt: 0,
    groupId: null,
    decision: "hold",
    ...overrides,
  };
}

describe("groupIdeasByRules", () => {
  it("clusters keywords that share a token", () => {
    const keywords = [keyword("a", "プッシュ通知"), keyword("b", "通知バッジ"), keyword("c", "料金プラン")];
    const groups = groupIdeasByRules(keywords);

    const notificationGroup = groups.find((group) => group.keywordIds.includes("a"));
    expect(notificationGroup?.keywordIds).toContain("b");
    expect(notificationGroup?.keywordIds).not.toContain("c");
  });

  it("clusters keywords mentioned in the same utterance", () => {
    const keywords = [
      keyword("a", "オフライン対応", { utteranceIds: ["utt-1"] }),
      keyword("b", "キャッシュ", { utteranceIds: ["utt-1"] }),
    ];
    const groups = groupIdeasByRules(keywords);

    expect(groups).toHaveLength(1);
    expect(groups[0].keywordIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("leaves singletons ungrouped for the caller to collect", () => {
    const keywords = [keyword("a", "オンボーディング"), keyword("b", "料金プラン")];
    const groups = groupIdeasByRules(keywords);

    expect(groups).toHaveLength(0);
  });
});

describe("parseGroupingResponse", () => {
  it("maps LLM group labels back to keyword ids", () => {
    const keywords = [keyword("a", "プッシュ通知"), keyword("b", "料金プラン")];
    const raw = '```json\n{"groups":[{"title":"通知","keywords":["プッシュ通知"]},{"title":"収益","keywords":["料金プラン"]}]}\n```';
    const groups = parseGroupingResponse(raw, keywords);

    expect(groups).toHaveLength(2);
    expect(groups[0].keywordIds).toEqual(["a"]);
    expect(groups[1].keywordIds).toEqual(["b"]);
  });

  it("ignores invented keywords and rejects empty results", () => {
    const keywords = [keyword("a", "プッシュ通知")];
    const raw = '{"groups":[{"title":"謎","keywords":["存在しないキーワード"]}]}';

    expect(() => parseGroupingResponse(raw, keywords)).toThrow();
  });
});
